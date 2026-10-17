// Löst Imports ohne Dateiendung auf .ts-Dateien auf (für node:test mit Type-Stripping).
import { register } from 'node:module';
register('./resolve.mjs', import.meta.url);
