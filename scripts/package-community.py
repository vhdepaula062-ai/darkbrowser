"""Package only project sources, public dependencies and redistributable runtime."""
from pathlib import Path
import json, os, zipfile, hashlib, contextlib
root=Path(__file__).resolve().parents[1]
out=root.parent/'deliverables';out.mkdir(exist_ok=True)
def add_tree(z, source, prefix, skip=()):
    source=Path(source)
    if not source.exists(): raise FileNotFoundError(source)
    n=0
    for folder, dirs, files in os.walk(source):
        dirs[:]=[d for d in dirs if d not in skip and d!='.git']
        for name in files:
            p=Path(folder)/name
            if name.startswith('.env') or name.endswith(('.log','.pyc','.bak')) or name.startswith('.verification') or name.startswith('.remaining'): continue
            z.write(p,str(Path(prefix)/p.relative_to(source)));n+=1
    print(prefix,n,flush=True)
class StreamingWriter:
    # No header rewrites/seeks for every tiny dependency file on a hard drive.
    def __init__(self, stream): self.stream=stream; self.position=0
    def write(self,data): self.position+=len(data);return self.stream.write(data)
    def tell(self):return self.position
    def seek(self,*args):raise OSError('streaming archive')
    def flush(self):self.stream.flush()
@contextlib.contextmanager
def archive(name):
    with (out/name).open('wb',buffering=8*1024*1024) as stream:
        with zipfile.ZipFile(StreamingWriter(stream),'w',compression=zipfile.ZIP_DEFLATED,compresslevel=1,allowZip64=True) as z:yield z
with archive('darkbrowser-project-complete.zip') as z:
    dirs=['src','src-tauri','scripts','public','ui-kit','crates','team-server','sdks','mcp','e2e','node_modules','dist']
    for d in dirs: add_tree(z,root/d,'DarkBrowser/'+d,skip=('target','__pycache__','test-results','playwright-report'))
    for p in root.iterdir():
        if p.is_file() and (p.suffix in ('.json','.ts','.html','.md','.cmd') or p.name in ('LICENSE','.gitignore')):z.write(p,'DarkBrowser/'+p.name)
    add_tree(z,root/'release-portable','DarkBrowser/portable')
    add_tree(z,'G:/DARKBROWSER_TOOLCHAINS/winlibs-mingw-16.2.0/mingw64','DarkBrowser/tools/mingw64')
    add_tree(z,'G:/DARKBROWSER_TOOLCHAINS/llvm-runtime/clang+llvm-23.1.6-x86_64-pc-windows-msvc','DarkBrowser/tools/llvm')
    add_tree(z,Path(os.environ['USERPROFILE'])/'.rustup/toolchains/stable-x86_64-pc-windows-gnu','DarkBrowser/tools/rust')
    add_tree(z,Path(os.environ['USERPROFILE'])/'.cargo/registry','DarkBrowser/tools/cargo/registry')
    add_tree(z,'C:/Program Files/nodejs','DarkBrowser/tools/node')
    bssl=Path('G:/DARKBROWSER_BUILD_TARGET/x86_64-pc-windows-gnu/release/build/btls-sys/96ee1704b1a2e2d7/out')
    add_tree(z,bssl/'boringssl','DarkBrowser/tools/bssl/boringssl')
    for name in ['libssl.a','libcrypto.a']:z.write(bssl/'build'/name,'DarkBrowser/tools/bssl/build/'+name)
print('Source archive finished',flush=True)
with archive('portable.zip') as z:add_tree(z,root/'release-portable','DarkBrowser')
for name in ['portable.zip','darkbrowser-project-complete.zip']:
    p=out/name
    with zipfile.ZipFile(p) as z:
        if z.testzip():raise RuntimeError('Corrupt ZIP: '+name)
    digest=hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
    p.with_suffix('.zip.sha256').write_text(digest+'  '+name+'\n')
    print(name,p.stat().st_size,digest,flush=True)
