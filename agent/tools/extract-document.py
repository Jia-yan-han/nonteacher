"""Extract document text locally; emit UTF-8 JSON without document content in logs."""
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

sys.stdout.reconfigure(encoding="utf-8")
file = Path(sys.argv[1]).resolve()
ext = file.suffix.lower()
units, warnings = [], []
MAX_UNITS = 100

def office_text(data):
    root = ET.fromstring(data)
    # Paragraph boundaries keep excerpts readable for indexing and preview.
    paras = []
    for p in root.iter():
        if p.tag.rsplit("}", 1)[-1] != "p":
            continue
        text = "".join(n.text or "" for n in p.iter() if n.tag.rsplit("}", 1)[-1] == "t")
        if text.strip(): paras.append(text.strip())
    return "\n".join(paras)

def unpack_office():
    with zipfile.ZipFile(file) as z:
        if sum(i.file_size for i in z.infolist()) > 100 * 1024 * 1024:
            raise ValueError("文档解压内容过大")
        if ext == ".pptx":
            names = sorted((n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)), key=lambda n: int(re.search(r"slide(\d+)", n).group(1)))
            for i, name in enumerate(names[:MAX_UNITS], 1):
                units.append({"label": f"第{i}张", "text": office_text(z.read(name))})
            if len(names) > MAX_UNITS: warnings.append(f"仅处理前 {MAX_UNITS} 张幻灯片")
            warnings.append("仅提取文本和表格文字，图片中的文字、图表及讲者备注未识别")
        else:
            names = [n for n in ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"] if n in z.namelist()]
            if not names or "word/document.xml" not in names: raise ValueError("无法找到 Word 正文")
            for name in names:
                units.append({"label": "正文" if name.endswith("document.xml") else "脚注", "text": office_text(z.read(name))})
            warnings.append("仅提取正文和表格文字，图片中的文字和图表未识别")

def pdf_text():
    from pypdf import PdfReader
    reader = PdfReader(file)
    if reader.is_encrypted and not reader.decrypt(""): raise ValueError("PDF 已加密，需要先解除密码")
    images = []
    with tempfile.TemporaryDirectory(prefix="nt-doc-") as tmp:
        for i, page in enumerate(reader.pages[:MAX_UNITS]):
            content = (page.extract_text() or "").strip()
            units.append({"label": f"第{i+1}页", "text": content})
            # OCR pages dominated by images even when page numbers have a text layer.
            if len(re.sub(r"\s", "", content)) < 80:
                try:
                    for j, image in enumerate(list(page.images)[:8]):
                        if len(image.data) < 4000: continue
                        dest = Path(tmp) / f"p{i+1}-{j}.png"
                        try:
                            from PIL import Image, ImageStat
                            from io import BytesIO
                            im = Image.open(BytesIO(image.data)).convert("RGB")
                            w, h = im.size
                            # Split contact sheets only when both central gutters are nearly white.
                            white = lambda box: min(ImageStat.Stat(im.crop(box)).mean) > 240
                            split = w >= 500 and h >= 350 and white((w//2-3, 0, w//2+3, h)) and white((0, h//2-3, w, h//2+3))
                            tiles = [im.crop(box) for box in ((0,0,w//2,h//2),(w//2,0,w,h//2),(0,h//2,w//2,h),(w//2,h//2,w,h))] if split else [im]
                            for k, tile in enumerate(tiles):
                                factor = min(3, 3500 / max(tile.size))
                                if factor > 1: tile = tile.resize((int(tile.width*factor), int(tile.height*factor)))
                                out = Path(tmp) / f"p{i+1}-{j}-{k}.png"
                                tile.save(out)
                                images.append({"page": i + 1, "path": str(out)})
                        except ImportError:
                            dest = dest.with_suffix(Path(image.name).suffix or '.png')
                            dest.write_bytes(image.data)
                            images.append({"page": i + 1, "path": str(dest)})
                except Exception:
                    warnings.append(f"第{i+1}页图片无法提取")
        if images and os.name == "nt":
            listing = Path(tmp) / "images.json"
            listing.write_text(json.dumps(images, ensure_ascii=False), encoding="utf-8")
            script = Path(__file__).with_name("ocr-images.ps1")
            proc = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script), "-ListPath", str(listing)], capture_output=True, timeout=120)
            if proc.returncode:
                warnings.append("图片页 OCR 未完成，请检查 Windows 中文 OCR 是否可用")
                for page_no in {item["page"] for item in images}:
                    unit = units[page_no - 1]
                    if len(re.sub(r"\s", "", unit["text"])) < 80: unit["text"] = ""
            else:
                for row in json.loads(proc.stdout.decode("utf-8-sig")):
                    if row.get("text"): units[row["page"]-1]["text"] += "\n[图片文字 OCR，可能有误]\n" + row["text"]
                    if row.get("error"): warnings.append(f"第{row['page']}页部分图片 OCR 失败")
        elif images:
            warnings.append("图片页 OCR 当前仅支持 Windows")
    if len(reader.pages) > MAX_UNITS: warnings.append(f"仅处理前 {MAX_UNITS} 页")
    if images: warnings.append("图片文字由本机 OCR 识别，可能漏字或出错，请核对原文")

try:
    if ext == ".pdf": pdf_text()
    elif ext in (".pptx", ".docx"): unpack_office()
    elif ext in (".ppt", ".doc"): raise ValueError("旧版 PPT/DOC 暂不支持，请另存为 PPTX/DOCX 后导入")
    else: raise ValueError("不支持的文档格式")
    units = [u for u in units if u["text"].strip()]
    if not units: warnings.append("未提取到文字；文件可能是图片或扫描件")
    print(json.dumps({"units":units, "warnings":list(dict.fromkeys(warnings))}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"units":[], "warnings":[str(exc)]}, ensure_ascii=False))
    sys.exit(1)
