import tika
from tika import parser

fileIn = "data/The Wall - John Lanchester.epub"
fileOut = "data/pronto/The Wall.txt"

# parsed = parser.from_file(fileIn, service='text')
# content = parsed["content"]

# with open(fileOut, 'w', encoding='utf-8') as fout:
#     fout.write(content)

from html.parser import HTMLParser
import ebooklib
from ebooklib import epub

class HTMLFilter(HTMLParser):
    """
    Source: https://stackoverflow.com/a/55825140/1209004
    """
    text = ""
    def handle_data(self, data):
        self.text += data

book = epub.read_epub(fileIn)
content = ""

for item in book.get_items():
    if item.get_type() == ebooklib.ITEM_DOCUMENT:
        bodyContent = item.get_body_content().decode()
        f = HTMLFilter()
        f.feed(bodyContent)
        content += f.text

with open(fileOut, 'w', encoding='utf-8') as fout:
        fout.write(content)