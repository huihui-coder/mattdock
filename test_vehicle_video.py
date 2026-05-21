import json, base64, urllib.request, os, subprocess, re
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.join(ROOT, 'videos', '电动车安全宣传与AI人群识别.mp4')
OUT_DIR = os.path.join(ROOT, 'test_vehicle_frames')
os.makedirs(OUT_DIR, exist_ok=True)

API_KEY = os.environ.get('DASHSCOPE_API_KEY', 'sk-3adf46c180c44ed99d69adb0b3a46234')
PROMPT = '请在图中检索并框选用户指定目标：「车辆」。只检测当前画面中真实、清晰、实体存在且与该描述明确匹配的目标；忽略视频转场造成的半透明重影、倒影、屏幕叠加画面、UI文字和模糊残影。车辆包括汽车、公交车、货车、电动车、摩托车、自行车等交通工具，不要框选行人、树木、道路、建筑。请返回目标最紧贴外轮廓的边界框，坐标范围固定为0-1000，格式：[{"label":"目标描述","bbox_2d":[x1,y1,x2,y2]}]。如果没有匹配目标，返回空数组[]。不要解释，不要输出Markdown，只返回JSON数组。最多返回20个最明显目标。'

def get_font(size=18):
    for fp in [r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simsun.ttc', r'C:\Windows\Fonts\simhei.ttf']:
        if os.path.exists(fp):
            return ImageFont.truetype(fp, size)
    return ImageFont.load_default()

def parse_boxes(text):
    clean = re.sub(r'```json|```', '', text).strip()
    try:
        parsed = json.loads(clean)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        match = re.search(r'\[[\s\S]*\]', text)
        if not match:
            return []
        try:
            parsed = json.loads(match.group(0))
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []

def call_qwen(image_b64):
    payload = json.dumps({
        'model': 'qwen3-vl-flash',
        'input': {'messages': [{'role': 'user', 'content': [
            {'image': 'data:image/jpeg;base64,' + image_b64},
            {'text': PROMPT}
        ]}]}
    }).encode('utf-8')
    req = urllib.request.Request(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        data=payload,
        headers={'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        result = json.load(resp)
    return result['output']['choices'][0]['message']['content'][0]['text']

def draw_result(img_path, boxes):
    img = Image.open(img_path).convert('RGB')
    w, h = img.size
    draw = ImageDraw.Draw(img)
    font = get_font(20)
    for idx, box in enumerate(boxes):
        bbox = box.get('bbox_2d') or box.get('bbox')
        if not isinstance(bbox, list) or len(bbox) < 4:
            continue
        x1, y1, x2, y2 = bbox[:4]
        px1 = int(min(x1, x2) / 1000 * w)
        py1 = int(min(y1, y2) / 1000 * h)
        px2 = int(max(x1, x2) / 1000 * w)
        py2 = int(max(y1, y2) / 1000 * h)
        draw.rectangle([px1, py1, px2, py2], outline='red', width=3)
        label = box.get('label') or f'车辆{idx + 1}'
        tb = font.getbbox(label)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
        ty = max(py1 - th - 8, 0)
        draw.rectangle([px1, ty, px1 + tw + 8, ty + th + 6], fill='red')
        draw.text((px1 + 4, ty + 2), label, fill='white', font=font)
    out = os.path.join(OUT_DIR, 'bbox_' + os.path.basename(img_path))
    img.save(out, quality=90)
    return out

print('抽帧:', VIDEO)
subprocess.run(['ffmpeg', '-y', '-i', VIDEO, '-vf', 'fps=1/3', os.path.join(OUT_DIR, 'frame_%04d.jpg')], check=True)
frames = sorted(f for f in os.listdir(OUT_DIR) if f.startswith('frame_') and f.endswith('.jpg'))
print('共抽取', len(frames), '帧')

for fname in frames[:5]:
    path = os.path.join(OUT_DIR, fname)
    with open(path, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode('utf-8')
    text = call_qwen(b64)
    boxes = parse_boxes(text)
    valid = []
    for box in boxes:
        bbox = box.get('bbox_2d') or box.get('bbox')
        if isinstance(bbox, list) and len(bbox) == 4 and all(isinstance(v, (int, float)) and 0 <= v <= 1000 for v in bbox):
            valid.append(box)
    out = draw_result(path, valid)
    print(fname, '返回', len(boxes), '个，有效', len(valid), '个 ->', out)
    print('原始返回:', text[:300].replace('\n', ' '))

print('完成，输出目录:', OUT_DIR)
