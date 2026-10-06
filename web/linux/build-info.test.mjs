import {test} from 'node:test';import assert from 'node:assert/strict';import {compareWebappBuild} from './build-info.mjs';
test('only known unequal loaded/server revisions require Refresh',()=>{assert.equal(compareWebappBuild('a','a'),false);assert.equal(compareWebappBuild('a','b'),true);assert.equal(compareWebappBuild('', 'b'),null);assert.equal(compareWebappBuild('a',null),null);});
