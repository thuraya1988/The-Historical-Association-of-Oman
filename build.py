"""Build the society's pages.
   python3 build.py  ->  docs/  (GitHub Pages, full documents)  and  artifacts/  (Claude artifact bodies)"""
import base64, json, os, re, subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")

def read(p):
    with open(os.path.join(ROOT, p), encoding="utf-8") as f:
        return f.read()

def data_uri(p):
    with open(os.path.join(ROOT, p), "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode()

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@500;700'
         '&family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Noto+Naskh+Arabic:wght@400;600&family=IBM+Plex+Mono&display=swap">')
BRAND_CSS = read("src/brand.css")

PAGES = [  # key, template, github file, nav label
    ("home", "index.html", "index.html", "الرئيسية"),
    ("majlis", "majlis.html", "majlis.html", "مجلس التاريخ"),
    ("calendar", "calendar.html", "on-this-day.html", "حدث في مثل هذا اليوم"),
    ("archive", "archive.html", "oral-history.html", "الذاكرة الصوتية"),
    ("sources", "sources.html", "sources.html", "مصادر عُمان في العالم"),
]
ARTIFACT_URLS = {
    "majlis": "https://claude.ai/artifact/8WDoGRV5EAS7xMxb2TmYp4",
    "calendar": "https://claude.ai/artifact/7HY8GnnrjhP1wnViacbXjA",
    "archive": "https://claude.ai/artifact/E2vCNT7W3G6yNBaSeN3MJZ",
    "sources": "https://claude.ai/artifact/MYnGs8pFaBqcLZJ32LeHAN",
}
REPO_URL = "https://github.com/thuraya1988/The-Historical-Association-of-Oman"

# counts from the data file
cnt = subprocess.run(["node", "-e",
    'const fs=require("fs");eval(fs.readFileSync(process.argv[1],"utf8")+";globalThis.FIGURES=FIGURES;globalThis.EVENTS=EVENTS");'
    'console.log(JSON.stringify([FIGURES.length,FIGURES.filter(f=>f.g==="f").length,EVENTS.length]))',
    os.path.join(SRC, "figures.js")], capture_output=True, text=True, check=True)
N_FIG, N_W, N_EV = json.loads(cnt.stdout)

def bar(current, mode, logos):
    links = []
    for key, _, gh, label in PAGES:
        if mode == "artifact":
            if key == "home" or key not in ARTIFACT_URLS:
                continue
            href = ARTIFACT_URLS[key]
        else:
            href = gh
        cur = ' aria-current="page"' if key == current else ""
        links.append(f'<a href="{href}"{cur}>{label}</a>')
    home = "index.html" if mode == "github" else REPO_URL
    return (f'<header class="ohs-bar"><a class="ohs-id" href="{home}">'
            f'<img class="logo-light" src="{logos["ml"]}" alt="" height="44">'
            f'<img class="logo-dark" src="{logos["md"]}" alt="" height="44">'
            '<span><b>الجمعية التاريخية العُمانية</b><small>The Historical Association of Oman</small></span></a>'
            f'<nav class="ohs-nav" aria-label="مشاريع الجمعية">{"".join(links)}</nav></header>')

FOOT = ('<footer class="ohs-foot"><span>الجمعية التاريخية العُمانية · مشاريع رقمية تعليمية</span>'
        '<span>التواريخ والمعلومات قابلة للمراجعة، ويُرحَّب بالتصويب.</span></footer>')

def build(mode):
    out_dir = os.path.join(ROOT, "docs" if mode == "github" else "artifacts")
    os.makedirs(out_dir, exist_ok=True)
    if mode == "github":
        import shutil
        shutil.copytree(os.path.join(ROOT, "assets"), os.path.join(out_dir, "assets"), dirs_exist_ok=True)
    if mode == "github":
        logos = {"ml": "assets/logo-mark-light.png", "md": "assets/logo-mark-dark.png",
                 "fl": "assets/logo-full-light.png", "fd": "assets/logo-full-dark.png"}
    else:
        logos = {"ml": data_uri("assets/logo-mark-light.png"), "md": data_uri("assets/logo-mark-dark.png"),
                 "fl": data_uri("assets/logo-full-light.png"), "fd": data_uri("assets/logo-full-dark.png")}
    canvas_logo = data_uri("assets/logo-full-light.png")  # canvas export needs an untainted image
    for key, tpl, gh, _ in PAGES:
        if mode == "artifact" and key == "home":
            continue
        s = read(os.path.join("src", tpl))
        head = ('<meta name="claude:viewport-fit-sides" content="cover">\n' + FONTS +
                "\n<style>\n" + BRAND_CSS + "\n</style>")
        s = (s.replace("{{HEAD}}", head)
              .replace("{{BAR}}", bar(key, mode, logos))
              .replace("{{FOOT}}", FOOT)
              .replace("{{FIGURES_JS}}", read("src/figures.js"))
              .replace("{{LOGO_FULL_LIGHT}}", canvas_logo if key == "calendar" else logos["fl"])
              .replace("{{LOGO_FULL_DARK}}", logos["fd"])
              .replace("{{N_FIG}}", str(N_FIG)).replace("{{N_W}}", str(N_W)).replace("{{N_EV}}", str(N_EV)))
        assert "{{" not in s, (tpl, re.findall(r"\{\{\w+\}\}", s))
        if mode == "github":
            cut = s.index("</style>", s.index("</style>") + 1) + len("</style>")  # brand css + page css
            title = re.search(r"<title>(.*?)</title>", s).group(1)
            meta = ('<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
                    '<link rel="icon" type="image/png" href="assets/favicon.png">\n'
                    f'<meta property="og:title" content="{title}">\n<meta property="og:image" content="assets/og.png">\n'
                    '<meta name="theme-color" content="#ee842a">\n')
            s = ('<!doctype html>\n<html lang="ar" dir="rtl">\n<head>\n' + meta + s[:cut] +
                 "\n</head>\n<body>\n" + s[cut:] + "\n</body>\n</html>\n")
        with open(os.path.join(out_dir, gh), "w", encoding="utf-8") as f:
            f.write(s)
    print(mode, "->", out_dir, sorted(os.listdir(out_dir)))

if __name__ == "__main__":
    build("github")
    build("artifact")
    print("figures", N_FIG, "women", N_W, "events", N_EV)
