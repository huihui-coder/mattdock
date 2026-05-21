import json, base64, urllib.request, os, subprocess, re
from PIL import Image, ImageDraw, ImageFont

# 加载系统中文字体
def get_font(size=18):
    font_paths = [
        r'C:\Windows\Fonts\msyh.ttc',   # 微软雅黑
        r'C:\Windows\Fonts\simsun.ttc',  # 宋体
        r'C:\Windows\Fonts\simhei.ttf',  # 黑体
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            return ImageFont.truetype(fp, size)
    return ImageFont.load_default()

video = r'c:\Users\彭于晏\Desktop\Project\政企\海珠\基于MQTT的异常告警\videos\警情案例.mp4'
out_dir = r'C:\Users\彭于晏\Desktop\frames3'
os.makedirs(out_dir, exist_ok=True)

# 每3秒抽一帧
subprocess.run([
    'ffmpeg', '-y', '-i', video,
    '-vf', 'fps=1/3',
    os.path.join(out_dir, 'frame_%04d.jpg')
], check=True)

frames = sorted([f for f in os.listdir(out_dir) if f.endswith('.jpg') and not f.startswith('bbox_')])
print(f'共抽取 {len(frames)} 帧')

PROMPT = '请分析图中可能存在的警情事件，检测所有警情相关的区域（如聚集人群、打架斗殴、违规停车、可疑人员、事故现场等），返回边界框和事件案由，格式：[{"label": "事件案由描述", "bbox": [x1, y1, x2, y2]}]，坐标范围0-1000。如果没有警情返回空数组[]'

for fname in frames:
    fpath = os.path.join(out_dir, fname)
    img = Image.open(fpath)
    w, h = img.size

    with open(fpath, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode()

    payload = json.dumps({
        'model': 'qwen3-vl-flash',
        'input': {'messages': [{'role': 'user', 'content': [
            {'image': 'data:image/jpeg;base64,' + b64},
            {'text': PROMPT}
        ]}]}
    }).encode()

    req = urllib.request.Request(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        data=payload,
        headers={'Authorization': 'Bearer sk-3adf46c180c44ed99d69adb0b3a46234', 'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req) as resp:
        result = json.load(resp)

    text = result['output']['choices'][0]['message']['content'][0]['text']
    text_clean = re.sub(r'```json|```', '', text).strip()
    try:
        boxes = json.loads(text_clean)
    except Exception as e:
        print(f'{fname}: 解析失败 - {text}')
        continue

    if not boxes:
        print(f'{fname}: 无警情')
        continue

    font = get_font(18)
    draw = ImageDraw.Draw(img)
    for box in boxes:
        x1, y1, x2, y2 = box['bbox']
        px1 = int(x1 / 1000 * w)
        py1 = int(y1 / 1000 * h)
        px2 = int(x2 / 1000 * w)
        py2 = int(y2 / 1000 * h)
        draw.rectangle([px1, py1, px2, py2], outline='red', width=3)
        label = box.get('label', '警情')
        # 计算文字宽高
        bbox_text = font.getbbox(label)
        tw = bbox_text[2] - bbox_text[0]
        th = bbox_text[3] - bbox_text[1]
        # 标签背景
        draw.rectangle([px1, py1 - th - 6, px1 + tw + 8, py1], fill='red')
        draw.text((px1 + 4, py1 - th - 4), label, fill='white', font=font)

    out_path = os.path.join(out_dir, 'bbox_' + fname)
    img.save(out_path, quality=85)
    for box in boxes:
        print(f'  - {box.get("label")}')
    print(f'{fname}: 检测到 {len(boxes)} 处警情 -> bbox_{fname}')

print('完成，结果保存在', out_dir)
