"""独立浏览器布局预览：合成题目、图片和模拟响应，不调用真实 API。"""
from pathlib import Path
from io import BytesIO
import base64
import json
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 24)
columns = ['字段', '数据类型', '约束', '注释']
rows = [['id', 'INT(11)', '主键、自增', '商品编号'], ['type', 'VARCHAR(30)', '非空', '商品类别'], ['name', 'VARCHAR(30)', '唯一', '商品名称'], ['price', 'DECIMAL(7,2)', '无符号', '商品价格'], ['num', 'INT(11)', '默认值为0', '商品库存'], ['add_time', 'DATETIME', '', '添加时间']]
image = Image.new('RGB', (1080, 280), 'white')
draw = ImageDraw.Draw(image)
for y in range(0, 281, 40): draw.line((0,y,1080,y), fill='#333333', width=2)
for x in range(0, 1081, 270): draw.line((x,0,x,280), fill='#333333', width=2)
for line, values in enumerate([columns] + rows):
    for col, text in enumerate(values):
        box = draw.textbbox((0,0),text,font=font)
        draw.text((col*270+(270-(box[2]-box[0]))/2, line*40+3), text, font=font, fill='#222222')
stream = BytesIO()
image.save(stream, format='PNG')
data = 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode('ascii')
script = json.dumps((root / '学习通AI助手.user.js').read_text(encoding='utf-8'), ensure_ascii=False).replace('</', '<\\/')
html = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>v1.06 作业布局模拟预览</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f3f4f7;color:#182336;font:16px/1.6 system-ui}header{background:#3e4c65;color:white;text-align:center;padding:10px}.preview-note{text-align:center;font-size:13px;color:#64748b;margin:16px}.fanyaMarking_left{max-width:900px;width:calc(100% - 32px);margin:24px auto;background:white;border-radius:12px}.detailsHead{position:relative;overflow:hidden;padding:0 0 20px;border-bottom:1px solid #eee}.mark_title{font-size:24px;line-height:1.5;padding:30px 40px 0;width:655px;margin:0}.infoHead{float:left;padding:14px 40px 0;font-size:14px;color:#64748b}.analysisCard{float:left;margin:14px 0;color:#94a3b8}.resultNum{position:absolute;right:40px;top:40px;color:#e97640;font-size:28px}.mark_table{padding:30px 40px}.mark_name{font-size:16px;font-weight:normal}.mark_name img{max-width:100%;height:auto}textarea{width:100%;min-height:90px;padding:12px;border:1px solid #dce2ed;border-radius:6px}dl{padding:12px;background:#f8fafc;margin:24px 0}.type_tit{font-size:20px}.questionLi{margin:24px 0}.workTextWrap{display:block}@media(max-width:600px){.mark_title{padding:20px 16px 0}.mark_table{padding:20px 16px}.infoHead{padding:14px 16px 0}}
</style><header>作业详情 · 本地模拟</header><p class="preview-note">合成表格与模拟模型响应，预览不访问 DeepSeek。点击助手可提取列表；生成可查看图片解析表格。</p>
<div class="fanyaMarking TiMu"><div class="fanyaMarking_left whiteBg"><div class="detailsHead"><h2 class="mark_title">项目：创建数据表</h2><div class="infoHead">题量: 2　满分:100<br>作答时间: 模拟页面</div><a class="analysisCard">智能分析</a><span class="resultNum">87.8分</span></div><div class="mark_table"><section class="mark_item"><h2 class="type_tit">一. 简答题（共2题，100分）</h2><div class="questionLi singleQuesId" id="preview-q1"><h3 class="mark_name">1. <span>(简答题)</span><span class="qtContent workTextWrap">根据表1，编写创建goods表的代码。<img alt="模拟表1" src="__IMAGE__"></span></h3><textarea aria-label="第一题答案"></textarea><dl><dt>答案区图片：应被排除</dt><dd><img width="80" src="__IMAGE__"></dd></dl></div><div class="questionLi singleQuesId" id="preview-q2"><h3 class="mark_name">2. <span>(简答题)</span><span class="qtContent workTextWrap">根据表1，查询库存小于10的商品。</span></h3><textarea aria-label="第二题答案"></textarea></div></section></div></div></div>
<script>const saved={deepseek_api_key:'mock-preview-key',cx_model:'deepseek-flash'}; window.GM_getValue=(key,fallback)=>saved[key]??fallback;window.GM_setValue=(key,value)=>{saved[key]=value};window.GM_getResourceText=()=> '{}';window.GM_xmlhttpRequest=request=>{if(request.method!=='POST')throw Error('预览禁止真实媒体请求');setTimeout(()=>{const p=JSON.parse(request.data),c=p.messages[1].content,d=JSON.parse(Array.isArray(c)?c[0].text:c);const payload={answers:d.questions.map((q,i)=>({id:q.id,answer:[i?'SELECT * FROM goods WHERE num < 10;':'CREATE TABLE goods (\\n  id INT(11) PRIMARY KEY AUTO_INCREMENT,\\n  type VARCHAR(30) NOT NULL,\\n  name VARCHAR(30) UNIQUE,\\n  price DECIMAL(7,2) UNSIGNED,\\n  num INT(11) DEFAULT 0,\\n  add_time DATETIME\\n);'],reason:'模拟回答，用于检查排版。'})),mediaAnalysis:(d.imageManifest||[]).map(m=>({imageId:m.imageIds[0],summary:'表1：goods表结构（模拟识别）',columns:__COLUMNS__,rows:__ROWS__,items:['共有6个字段']}))};request.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(payload)}}]})});},450);};eval(__SCRIPT__);</script></html>'''
html = html.replace('__IMAGE__',data).replace('__COLUMNS__',json.dumps(columns,ensure_ascii=False)).replace('__ROWS__',json.dumps(rows,ensure_ascii=False)).replace('__SCRIPT__',script)
catalog = '<div id="content1" hidden><div id="coursetree"><ul><li><div class="posCatalog_select" id="preview-group"><span class="posCatalog_title" title="数据库基础"><em class="posCatalog_sbar">1</em>数据库基础</span></div><ul>'
for number, title in enumerate(['创建数据表', '数据查询', '数据约束', '索引与视图', '综合练习'], 1):
    state = '<span class="icon_Completed"></span>' if number < 3 else '<span class="orangeNew">1</span>'
    active = ' posCatalog_active' if number == 1 else ''
    catalog += f'<li><div class="posCatalog_select{active}" id="cur{number}"><span class="posCatalog_name" title="{title}"><em class="posCatalog_sbar">1.{number}</em>{title}</span>{state}</div></li>'
catalog += '</ul></li></ul></div></div>'
html = html.replace('<script>const saved=', catalog + '<script>const saved=')
(root / 'tests/作业图文预览.html').write_text(html,encoding='utf-8')
print('Built tests/作业图文预览.html (mock only)')
