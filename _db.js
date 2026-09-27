const fs=require('fs');
const p='docs/DOC-BASELINE.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.files['docs/PROCESS-04-工作规范.md']={
  must:['先判别-最小测试','失败两次刹车','证据落盘','review 后 stop',
    '## 1. 沟通规范','## 2. 预检门(pre-check gate)','## 3. 证据与置信度','## 4. 竞争假设','## 5. 证据价值',
    '## 6. 最小变更','## 7. 实验隔离','## 8. 行动闭环、持久化与工具经济','## 9. 失败制动',
    '## 10. 范围控制','## 11. 停止、预算与输出','## 12. UI 验证交接','## 13. 与既有流程的关系'],
  mustNot:[]
};
j.updatedAt='2026-09-25';
fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n','utf8');
console.log('DOC-BASELINE 已加 PROCESS-04 断言(' + j.files['docs/PROCESS-04-工作规范.md'].must.length + ' 条 must)');
