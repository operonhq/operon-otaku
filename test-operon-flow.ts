/**
 * Quick test: hit the Operon server directly using the same
 * credentials the SDK would use, to verify the full placement flow.
 */

import 'dotenv/config';

const OPERON_URL = process.env.OPERON_URL || 'http://localhost:3100';
const OPERON_API_KEY = process.env.OPERON_API_KEY || '';
const CATEGORY = process.env.OPERON_DEFAULT_CATEGORY || 'market_analysis';
const INTENT = process.env.OPERON_DEFAULT_INTENT || 'allocation_advice';

async function main() {
  console.log(`\nOperon E2E Test`);
  console.log(`Server: ${OPERON_URL}`);
  console.log(`API Key: ${OPERON_API_KEY.slice(0, 8)}...`);
  console.log(`Category: ${CATEGORY}, Intent: ${INTENT}\n`);

  const body = {
    impressionContext: {
      publisher: 'operon-otaku',
      slotType: 'agent-response',
      requestContext: {
        query: 'What should I do with 0.5 ETH?',
        category: CATEGORY,
        asset: 'ETH',
        amount: '0.5',
        intent: INTENT,
      },
      responseContext: {
        actions: ['Hold', 'Scale in', 'Execute'],
        sentiment: 'neutral_to_bullish',
      },
    },
  };

  const res = await fetch(`${OPERON_URL}/placement`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPERON_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (data.decision === 'filled') {
    console.log('PLACEMENT FILLED');
    console.log(`  Winner: ${data.placement.service}`);
    console.log(`  ScoutScore: ${data.placement.scoutScore}`);
    console.log(`  Rank: ${data.placement.rank}`);
    console.log(`  Bid: ${data.placement.bidPrice}`);
    console.log(`  Routable: ${data.placement.routable}`);
    console.log(`  Endpoint: ${data.placement.endpoint}`);
    console.log(`\n  Auction: ${data.auction.eligible}/${data.auction.candidates} eligible`);
    console.log(`\nFull flow works. The SDK would inject this into the agent response.`);
  } else {
    console.log('PLACEMENT BLOCKED');
    console.log(`  Reason: ${data.reason}`);
    console.log('\nCheck category/intent match and MOCK_SCOUTSCORE=true on the server.');
  }
}

main().catch(console.error);
