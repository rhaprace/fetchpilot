import { fetchpilot } from '../dist/index.js';

async function main() {
  const res = await fetchpilot('https://httpbin.org/json', { retries: 3 });
  if (!res.ok) {
    console.error('Error:', res.error.type, res.error.message);
  } else {
    console.log('Status:', res.status);
    console.log('Keys:', Object.keys(res.data));
  }
}

main();
