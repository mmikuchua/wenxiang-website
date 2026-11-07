import { readFileSync } from 'node:fs';
import { rankActivities } from '../web/assets/js/engine.js';

const payload = JSON.parse(readFileSync(new URL('../web/data/activities.json', import.meta.url), 'utf8'));
const profile = {
  age: 'B', education: 'D', living: 'D', occupation: 'B', income: 'C', time: 'B',
  actTypes: ['A', 'C'], demand: 'A', comfort: 'A', focus: 'A', traffic: 'A',
};
const { items } = rankActivities(profile, payload.activities, { limit: 20 });
for (const item of items) {
  console.log(
    String(item.percent).padStart(3),
    item.activity.source.padEnd(10),
    item.activity.name.slice(0, 34).padEnd(36),
    item.activity.tags.categories.join(''),
  );
}
