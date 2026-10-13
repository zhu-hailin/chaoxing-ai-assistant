// 旧图文流程夹具明确选择模拟型号，并提供模拟图片实测证据；生产脚本不使用这些型号。
const endpoints={deepseek:'https://api.deepseek.com',openai:'https://api.openai.com/v1',qwen:'https://dashscope.aliyuncs.com/compatible-mode/v1',kimi:'https://api.moonshot.cn/v1',glm:'https://open.bigmodel.cn/api/paas/v4'};
function fingerprint(value){let hash=14695981039346656037n;for(const c of value){hash^=BigInt(c.codePointAt(0));hash=BigInt.asUintN(64,hash*1099511628211n);}return hash.toString(16).padStart(16,'0');}
function fixtureImageCapabilities(profiles=[['deepseek','deepseek-flash'],['deepseek','deepseek-v4-flash'],['deepseek','deepseek-v4-flash-vision-exp'],['openai','gpt-4.1-mini'],['openai','gpt-4.1'],['qwen','qwen3-vl-plus'],['kimi','kimi-k2.6'],['glm','glm-5.3-flash']]){
 return profiles.map(([provider,model])=>({provider,model,endpointFingerprint:fingerprint(endpoints[provider]),images:true,evidence:'image-test',checkedAt:1}));
}
function withModelFixture(getValue){return (key,fallback)=>getValue(key,key==='cx_model'?'deepseek-flash':key==='cx_model_image_capabilities'?fixtureImageCapabilities():fallback);}
module.exports={withModelFixture,fixtureImageCapabilities};
