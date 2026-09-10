import { createHash } from 'node:crypto';
import { expect,test } from 'vitest';
import { readProvenance,withProvenance } from './provenance.js';
test('nfo provenance round-trips the exact two-line header and pretty body hash',()=>{
  const body='<movie>\n  <title>Title</title>\n</movie>\n',text=withProvenance(body,'42',123);
  expect(text.split('\n')[0]).toBe('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  expect(readProvenance(text)).toMatchObject({generated_at:123,source_id:'42',body,hash:createHash('sha256').update(body).digest('hex')});
  expect(readProvenance('<movie/>')).toBeNull();expect(()=>withProvenance(body,'-->')).toThrow();
});
