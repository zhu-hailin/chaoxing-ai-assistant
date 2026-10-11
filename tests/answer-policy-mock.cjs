// 分类与答案使用不同的模拟协议和记录，分类调用不占用旧答案批次索引。
function policyInput(request) {
  if(request.method!=='POST' || !request.data)return null;
  try{const p=JSON.parse(request.data),c=p.messages?.find(m=>m.role==='user')?.content;
    const text=Array.isArray(c)?c.find(part=>part.type==='text')?.text:c;
    const input=JSON.parse(text);return input.task==='answer-policy'?input:null;
  }catch{return null;}
}
function respondPolicy(request,input=policyInput(request)) {
  const classifications=input.questions.map(q=>({id:q.id,status:'auto',category:['single','multiple','judge'].includes(q.type)?'objective':q.type==='blank'?'text-blank':'knowledge',reason:'模拟确认可直接文字或选择作答',evidence:q.question || '模拟图片要求'}));
  request.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({classifications})}}]})});
}
module.exports={policyInput,respondPolicy};
