"""Turn dist-web/index.html (vite --mode web) into a page body for a hosted prototype:
drops the document skeleton (the host adds its own) and keeps the inline style + script."""
import sys

src, dst = sys.argv[1], sys.argv[2]
html = open(src, encoding='utf8').read()
h0 = html.index('<head>') + len('<head>')
h1 = html.rindex('</head>')          # last one: library code can contain the string "</head>"
b0 = html.index('<body>', h1) + len('<body>')
b1 = html.rindex('</body>')
head = html[h0:h1]
# strip the leading meta/title tags (they sit before the big inline script/style)
first_code = min(i for i in (head.find('<script'), head.find('<style')) if i >= 0)
out = '<title>Animal Care Clinic</title>\n' + head[first_code:].strip() + '\n' + html[b0:b1].strip() + '\n'
open(dst, 'w', encoding='utf8').write(out)
print(f'{dst}: {len(out):,} bytes')
