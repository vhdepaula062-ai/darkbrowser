"""Generate the public UI catalog; preserves interpolation and markup tokens."""
import json, re, time, urllib.request, urllib.parse, concurrent.futures
from pathlib import Path
root = Path(__file__).resolve().parents[1]
source = json.loads((root/'src/shared/i18n/locales/en.json').read_text(encoding='utf-8'))
dest = root/'src/shared/i18n/locales/pt-BR.json'
translated = json.loads(dest.read_text(encoding='utf-8')) if dest.exists() else {}
def translate(item):
    key, value = item
    if key in translated: return key, translated[key]
    tokens=[]
    def protect(m):
        tokens.append(m.group()); return f'ZXQ{len(tokens)-1}QXZ'
    text=re.sub(r'\{[^{}]*\}|</?[^>]+>|https?://[^\s]+|`[^`]+`', protect, value)
    time.sleep(0.5)
    for attempt in range(5):
        try:
            url='https://translate.googleapis.com/translate_a/single?'+urllib.parse.urlencode(dict(client='gtx',sl='en',tl='pt',dt='t',q=text))
            data=json.loads(urllib.request.urlopen(url,timeout=30).read())
            result=''.join(part[0] or '' for part in data[0])
            for i, token in enumerate(tokens): result=re.sub(f'ZXQ\\s*{i}\\s*QXZ',lambda _:token,result,flags=re.I)
            if 'ZXQ' in result: raise ValueError('Unrestored placeholder')
            if sorted(re.findall(r'\{[^{}]*\}',value)) != sorted(re.findall(r'\{[^{}]*\}',result)): raise ValueError('Placeholder mismatch')
            return key,result
        except Exception:
            if attempt==4: raise
            time.sleep(2**attempt)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    for n,(key,value) in enumerate(pool.map(translate,source.items()),1):
        translated[key]=value
        if n%50==0:
            dest.write_text(json.dumps(translated,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
            print(f'{n}/{len(source)}',flush=True)
dest.write_text(json.dumps(translated,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


