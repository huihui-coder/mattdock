import sys
import json
import base64
import io

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.stderr.write("ERROR: Pillow not installed. Run: pip install Pillow\n")
    sys.exit(1)

def draw_boxes(image_b64, boxes, video_width, video_height):
    img_bytes = base64.b64decode(image_b64)
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    img_w, img_h = img.size

    scale_x = img_w / 1000
    scale_y = img_h / 1000

    draw = ImageDraw.Draw(img)

    font = ImageFont.load_default()
    for font_path in [
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\msyhbd.ttc",
        r"C:\Windows\Fonts\simsun.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\Deng.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]:
        try:
            test_font = ImageFont.truetype(font_path, 20)
            test_font.getmask("车辆测试")
            font = test_font
            break
        except Exception:
            pass

    for idx, box in enumerate(boxes):
        bbox = box.get("bbox") or box.get("bbox_2d")
        if not bbox or len(bbox) < 4:
            continue
        x1, y1, x2, y2 = bbox
        rx1 = min(x1, x2) * scale_x
        ry1 = min(y1, y2) * scale_y
        rx2 = max(x1, x2) * scale_x
        ry2 = max(y1, y2) * scale_y

        color = "#ef4444"
        draw.rectangle([rx1, ry1, rx2, ry2], outline=color, width=3)

        label = box.get("label") or f"目标{idx + 1}"
        try:
            bbox_text = font.getbbox(label)
            text_w = bbox_text[2] - bbox_text[0]
            text_h = bbox_text[3] - bbox_text[1]
        except Exception:
            text_w, text_h = len(label) * 12, 16

        tag_x1 = rx1
        tag_y1 = ry1 - text_h - 6
        tag_y1 = max(tag_y1, 0)
        draw.rectangle([tag_x1, tag_y1, tag_x1 + text_w + 8, tag_y1 + text_h + 4], fill=color)
        draw.text((tag_x1 + 4, tag_y1 + 2), label, fill="white", font=font)

    out_buf = io.BytesIO()
    img.save(out_buf, format="JPEG", quality=90)
    return base64.b64encode(out_buf.getvalue()).decode("utf-8")


if __name__ == "__main__":
    try:
        data = json.loads(sys.stdin.read())
        image_b64 = data["image"]
        boxes = data.get("boxes", [])
        video_width = data.get("videoWidth", 1920)
        video_height = data.get("videoHeight", 1080)
        result_b64 = draw_boxes(image_b64, boxes, video_width, video_height)
        print(json.dumps({"success": True, "image": result_b64}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)
