import { buildApp } from './src/app/build-app.js';
import fs from 'node:fs';

async function main() {
  const app = await buildApp();
  await app.ready(); // Ensure plugins are loaded
  
  const response = await app.inject({
    method: 'GET',
    url: '/docs/json'
  });
  
  fs.writeFileSync('swagger.json', response.payload);
  console.log('Swagger JSON saved to swagger.json');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
