import * as E from '../../web/engine.js';
import * as P from '../../web/prompts.js';
const g = { id:'g1', type:'begrepp', weight:2 };
let m = E.newMastery('g1'), now = Date.now(), ev=[];
for (const s of [1,1,0,1,1,1,1,1,1]) { const r = E.applyResult(m, g, {score:s, itemId:'i', now, testDate:'2026-11-20'}); m=r.mastery; ev.push(r.event||'-'); now+=1000; }
console.log('events', ev.join(','), 'level', m.level, 'passedMax', m.passedMax);
let d = E.newMastery('g1'); d.level=2; for (const s of [0,0,0]) d = E.applyResult(d, g, {score:s, now, testDate:null}).mastery;
console.log('after 3 misses level', d.level);
console.log(E.compareText('Grundamne',['grundämne']), E.compareText('grundämen',['grundämne']), E.compareText('kol',['kol']));
const mats=[{ref:'m1',pages:[{p:1}]}];
const bank = P.validateBank({items:[{goal:'g1',level:1,kind:'mcq',q:'?',options:['a','b','c'],answer:1,src:{m:'m1',p:1}},{goal:'g1',level:2,kind:'cloze',q:'X är ___.',answer:'y',src:{m:'m1',p:9}}]},[{id:'g1',type:'begrepp'}], new Set(['m1:1']));
console.log('bank errors', bank.errors);
console.log(E.pickNext({goals:[g], masteryById:{}, banks:{g1:[{id:'a',level:1},{id:'b',level:2}]}, now:Date.now()}).item.id);
