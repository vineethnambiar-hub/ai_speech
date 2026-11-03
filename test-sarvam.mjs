import { config } from 'dotenv';
import { SarvamAIClient } from 'sarvamai';

config(); // load .env

const key = process.env.SARVAM_API_KEY;
if (!key) {
  console.error('SARVAM_API_KEY is not set in .env — paste your key and try again.');
  process.exit(1);
}

const client = new SarvamAIClient({ apiSubscriptionKey: key });

const response = await client.chat.completions({
  model: 'sarvam-105b-conversations',
  messages: [
    { role: 'user', content: 'In one sentence, what is Sarvam AI?' },
  ],
});

console.log(response.choices[0].message.content);
