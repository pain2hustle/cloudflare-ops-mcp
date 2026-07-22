#!/usr/bin/env node
import { randomBytes } from 'node:crypto';

const key = 'zm_' + randomBytes(32).toString('base64url');
console.log(key);
console.error('');
console.error('Use this as MCP_ACCESS_KEY:');
console.error('  cd worker');
console.error('  npx wrangler secret put MCP_ACCESS_KEY');
console.error('');
console.error('Then connect MCP clients with:');
console.error('  Authorization: Bearer ' + key);
