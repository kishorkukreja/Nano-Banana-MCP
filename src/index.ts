#!/usr/bin/env node

import { NanoBananaMCP } from "./server.js";

const server = new NanoBananaMCP();
server.run().catch(console.error);
