// Test script to verify agent responses are specific, not vague
// Run with: node --loader ts-node/esm backend/test-responses.ts

import fetch from "node-fetch";

const API_URL = "http://localhost:3000/ask";

interface TestCase {
  prompt: string;
  shouldContain: string[];
  shouldNotContain: string[];
}

const testCases: TestCase[] = [
  {
    prompt: "Show Keerti's latest case study",
    shouldContain: [
      // Should have actual project names, not placeholders
      "Search",
      "Zentra",
      "LMS",
      "Optym"
    ],
    shouldNotContain: [
      "[insert",
      "[project",
      "[brief",
      "[describe",
      "[outline",
      "[share"
    ]
  },
  {
    prompt: "What projects has Keerti worked on?",
    shouldContain: [
      // Should list actual project names
      "Search",
      "Zentra",
      "LMS"
    ],
    shouldNotContain: [
      "[",
      "placeholder",
      "insert here"
    ]
  },
  {
    prompt: "Tell me about Keerti's design process",
    shouldContain: [
      // Should mention actual methodologies or steps
      "research",
      "design",
      "user"
    ],
    shouldNotContain: [
      "[Outline",
      "[methodologies",
      "tools used]"
    ]
  },
  {
    prompt: "What was the impact of her work?",
    shouldContain: [
      // Should have actual outcomes or metrics
      // If the PDFs contain metrics, they should appear here
    ],
    shouldNotContain: [
      "[Share the results",
      "[impact",
      "project]"
    ]
  }
];

async function testAgent() {
  console.log("🧪 Testing Agent Responses for Specificity\n");
  console.log("=" .repeat(60));

  let passed = 0;
  let failed = 0;

  for (const test of testCases) {
    console.log(`\n📝 Testing: "${test.prompt}"`);
    
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: test.prompt }),
      });

      const data = await response.json();
      const answer = data.answer || "";

      console.log(`\n💬 Response (first 200 chars):\n${answer.slice(0, 200)}...\n`);

      // Check for forbidden patterns
      const foundForbidden = test.shouldNotContain.filter(pattern => 
        answer.includes(pattern)
      );

      if (foundForbidden.length > 0) {
        console.log(`❌ FAIL: Found forbidden patterns: ${foundForbidden.join(", ")}`);
        failed++;
      } else {
        console.log(`✅ PASS: No placeholder text detected`);
        passed++;
      }

      // Check for required content (optional, might not always be present)
      const foundRequired = test.shouldContain.filter(pattern =>
        answer.toLowerCase().includes(pattern.toLowerCase())
      );

      if (foundRequired.length > 0) {
        console.log(`✅ Contains specific terms: ${foundRequired.join(", ")}`);
      } else {
        console.log(`⚠️  Note: Could be more specific about ${test.shouldContain.join(", ")}`);
      }

    } catch (error) {
      console.log(`❌ ERROR: ${error}`);
      failed++;
    }

    console.log("-".repeat(60));
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log(`\n🎉 All tests passed! Agent is responding with specific details.`);
  } else {
    console.log(`\n⚠️  Some tests failed. Review system prompt and ensure PDFs are loaded.`);
  }
}

// Run tests
testAgent().catch(console.error);
