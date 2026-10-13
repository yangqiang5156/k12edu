import { loadConfiguration } from './environment.mjs';
Object.assign(process.env, loadConfiguration());
