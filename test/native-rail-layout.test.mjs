import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeRailContentLimit, createNativeRailGutter } from '../src/native-rail-layout.mjs';
test('output panel shift leaves room for the native marker visibility threshold',()=>{
 const width=1126.48,shift=-158,limit=nativeRailContentLimit(width,shift);
 assert.equal(limit,706);assert.ok((width-limit)/2+shift>=48);
 assert.equal(nativeRailContentLimit(600,-158),null);assert.equal(nativeRailContentLimit(NaN,0),null);
});
test('gutter sizing follows resize and restores the previous inline width',()=>{
 let width=1126;const values=new Map([['max-width','800px']]),style={getPropertyValue:k=>values.get(k)||'',getPropertyPriority:()=>'',setProperty:(k,v)=>values.set(k,v),removeProperty:k=>values.delete(k)};
 const content={style,parentElement:{getBoundingClientRect:()=>({left:180})}},scroll={get offsetWidth(){return width},getBoundingClientRect:()=>({left:338,width})};
 const gutter=createNativeRailGutter(nativeRailContentLimit);gutter.update(content,scroll);assert.match(values.get('max-width'),/706px/);
 width=1300;gutter.update(content,scroll);assert.match(values.get('max-width'),/880px/);gutter.dispose();assert.equal(values.get('max-width'),'800px');
 gutter.update(content,scroll);values.set('max-width','900px');gutter.dispose();assert.equal(values.get('max-width'),'900px');
});
