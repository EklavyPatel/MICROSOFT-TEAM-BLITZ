import { configuration } from '../config.js';
import { openDatabase } from './index.js';
const db = openDatabase(configuration().dbPath);
db.close();
console.log('WatchCircle database schema initialized.');
