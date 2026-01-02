# Troubleshooting Vague Agent Responses

## Still Seeing Placeholder Text?

Follow this diagnostic checklist to identify and fix the root cause.

---

## 🔍 Step 1: Verify Backend is Running Updated Code

### Check 1: Server Restart
```bash
# Stop any running instances
pkill -f "node.*server"

# Start fresh
cd /workspace/backend
npm run dev
```

**Look for in logs:**
```
🚧 Building vector store...
📄 RAW DOC COUNT: 3
✂️ TOTAL SPLIT CHUNKS: [should be 50+]
🧠 Vector store created successfully!
```

### Check 2: System Prompt Loaded
```bash
# Verify the new system prompt is in place
cat backend/systemprompt.ts | grep "CRITICAL RULES"
```

**Should output:** `🎯 CRITICAL RULES - READ CAREFULLY:`

**If not found:** The old prompt is still loaded. Clear cache:
```bash
rm -rf node_modules/.cache
npm run dev
```

---

## 🔍 Step 2: Verify PDFs Are Being Loaded

### Check Server Logs

When server starts, you should see:
```
Loading PDF source: /workspace/backend/data/Optym - LMS.pdf
   → Loaded 12 pages from PDF
Loading PDF source: /workspace/backend/data/Search-Feature case study.pdf
   → Loaded 8 pages from PDF
Loading PDF source: /workspace/backend/data/Zentra Case study.pdf
   → Loaded 35 pages from PDF
```

### If Not Seeing This:

**Problem:** PDFs aren't being found

**Solution:**
```bash
# Verify PDFs exist
ls -la /workspace/backend/data/*.pdf

# Should show:
# Optym - LMS.pdf
# Search-Feature case study.pdf
# Zentra Case study.pdf

# If missing, check DATA_DIR environment variable
echo $DATA_DIR
```

---

## 🔍 Step 3: Check Context Quality

### Test Context Retrieval

Send a test query and check logs:

```bash
# In another terminal, send test request
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -d '{"message":"Show Keerti's latest case study"}'
```

### Look for in Server Logs:

```
--- MATCH 1
[Should show actual text from case study PDFs]

🧠 FINAL CONTEXT SENT TO LLM:
[Should show several paragraphs of actual case study content]
```

### If Context is Empty or Just Metadata:

**Problem:** Embeddings aren't matching well

**Solutions:**

1. **Rebuild vector store:**
   ```bash
   # Backend rebuilds on restart
   # Force fresh build
   rm -rf /tmp/vectorstore-cache
   npm run dev
   ```

2. **Lower similarity threshold (add to server.ts):**
   ```typescript
   // After line 263
   const searchResults = await vectorstore.similaritySearchWithScore(
     trimmedMessage, 
     8
   );
   
   // Add this to see scores:
   console.log("Similarity scores:", searchResults.map(([_, score]) => score));
   ```

3. **Try different embedding model:**
   ```typescript
   // In server.ts, line ~223
   const embeddings = new OpenAIEmbeddings({
     model: "text-embedding-3-large", // Was text-embedding-3-small
     apiKey: process.env.OPENAI_API_KEY,
   });
   ```

---

## 🔍 Step 4: Test API Key and Model

### Check OpenAI API Key
```bash
# Should say "Loaded"
# Look in server logs:
🔑 OPENAI KEY: Loaded
```

**If shows "❌ Missing":**
```bash
# Check .env file
cat .env | grep OPENAI_API_KEY

# Should have:
OPENAI_API_KEY=sk-...

# If missing, create .env:
echo "OPENAI_API_KEY=your-key-here" > backend/.env
```

### Test Different Model

If `gpt-4o-mini` isn't following instructions well:

```typescript
// In server.ts, line ~287
const completion = await openai.chat.completions.create({
  model: "gpt-4o", // Instead of gpt-4o-mini
  temperature: 0.5,
  messages,
});
```

**Note:** `gpt-4o` is more expensive but better at following complex instructions.

---

## 🔍 Step 5: Increase Context Window

If responses are specific but incomplete:

### Option A: More Search Results
```typescript
// In server.ts, line ~263
const searchResults = await vectorstore.similaritySearchWithScore(
  trimmedMessage, 
  12 // Increased from 8
);
```

### Option B: Larger Chunks
```typescript
// In server.ts, line ~212
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 3000,    // Increased from 2000
  chunkOverlap: 600,  // Increased from 400
});
```

### Option C: Both
Do both A and B for maximum context.

---

## 🔍 Step 6: Add Response Validation

Catch placeholders programmatically:

```typescript
// In server.ts, after line ~293
const answer = completion.choices[0].message.content;

// Add validation:
if (answer && answer.includes('[') && answer.includes(']')) {
  console.error('⚠️ PLACEHOLDER DETECTED IN RESPONSE!');
  console.error('Response:', answer);
  
  // Option: Retry with stronger prompt
  // or filter out the brackets
}

res.json({ answer });
```

---

## 🔍 Step 7: Test Specific Queries

### Create Test Suite

```bash
cd /workspace/backend
node --loader ts-node/esm test-responses.ts
```

This will test:
- Case study queries
- Project listings
- Design process questions
- Impact questions

**Look for:**
```
✅ PASS: No placeholder text detected
✅ Contains specific terms: Search, Zentra, LMS
```

---

## 🔍 Step 8: Examine PDF Content

Make sure PDFs actually contain extractable text:

```bash
# Install pdftotext if needed
sudo apt-get install poppler-utils

# Extract text from PDF
pdftotext "/workspace/backend/data/Search-Feature case study.pdf" - | head -50

# Should show actual text content
# If shows nothing or gibberish, PDF might be image-based
```

**If PDFs are image-based:**
You'll need OCR. Add to your PDF loader:

```typescript
// In server.ts, loadPDF function
const loader = new PDFLoader(filePath, {
  splitPages: true,
  pdfjs: () => import("pdfjs-dist/legacy/build/pdf.js"),
});
```

---

## 🧪 Quick Diagnostic Script

Save as `backend/diagnose.ts`:

```typescript
import fs from "fs";
import path from "path";

console.log("🔍 Diagnostic Check\n");

// Check 1: System prompt
const systemPrompt = fs.readFileSync("backend/systemprompt.ts", "utf8");
const hasRules = systemPrompt.includes("CRITICAL RULES");
console.log(`✓ System prompt updated: ${hasRules ? "YES ✅" : "NO ❌"}`);

// Check 2: PDFs exist
const dataDir = path.join(__dirname, "data");
const pdfs = fs.readdirSync(dataDir).filter(f => f.endsWith(".pdf"));
console.log(`✓ PDFs found: ${pdfs.length} files`);
pdfs.forEach(pdf => console.log(`  - ${pdf}`));

// Check 3: Server.ts changes
const serverCode = fs.readFileSync("backend/server.ts", "utf8");
const hasChunkSize = serverCode.includes("chunkSize: 2000");
const hasTemp = serverCode.includes("temperature: 0.5");
const hasContext8 = serverCode.includes("similaritySearchWithScore(trimmedMessage, 8)");
console.log(`✓ Chunk size updated: ${hasChunkSize ? "YES ✅" : "NO ❌"}`);
console.log(`✓ Temperature updated: ${hasTemp ? "YES ✅" : "NO ❌"}`);
console.log(`✓ Context retrieval updated: ${hasContext8 ? "YES ✅" : "NO ❌"}`);

// Check 4: Env vars
console.log(`✓ OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "SET ✅" : "MISSING ❌"}`);

console.log("\n🎯 If all checks pass, restart backend and test.");
```

Run with:
```bash
node --loader ts-node/esm backend/diagnose.ts
```

---

## 🚨 Common Issues & Fixes

### Issue 1: "Still seeing [insert X]"
- ✅ **Solution:** Clear node cache, restart server
- ✅ **Verify:** New system prompt is loaded

### Issue 2: "Responses are too short"
- ✅ **Solution:** Increase context chunks to 10-12
- ✅ **Solution:** Use larger chunk sizes (3000)

### Issue 3: "Context logs show empty or metadata only"
- ✅ **Solution:** Rebuild vector store
- ✅ **Solution:** Try different embedding model
- ✅ **Check:** PDFs contain extractable text

### Issue 4: "Model not following instructions"
- ✅ **Solution:** Switch to gpt-4o
- ✅ **Solution:** Add response validation
- ✅ **Solution:** Make system prompt even more explicit

### Issue 5: "Some queries work, others don't"
- ✅ **Solution:** Context might not match query well
- ✅ **Solution:** Increase search results
- ✅ **Solution:** Check similarity scores in logs

---

## 📞 Need More Help?

### Enable Debug Mode

Add to server.ts:
```typescript
// After line ~263
console.log("DEBUG: Search query:", trimmedMessage);
console.log("DEBUG: Similarity scores:", 
  searchResults.map(([_, score]) => score)
);
console.log("DEBUG: Context chunks:", searchResults.length);
console.log("DEBUG: Context length:", context.length, "chars");
```

### Test Individual Components

1. **Test PDF loading:**
   ```typescript
   const docs = await loadPDF("backend/data/Search-Feature case study.pdf");
   console.log("Pages:", docs.length);
   console.log("First page:", docs[0].pageContent.slice(0, 500));
   ```

2. **Test embeddings:**
   ```typescript
   const embedding = await embeddings.embedQuery("case study");
   console.log("Embedding dimensions:", embedding.length);
   ```

3. **Test vector search:**
   ```typescript
   const results = await vectorstore.similaritySearch("latest case study", 3);
   results.forEach(doc => console.log(doc.pageContent.slice(0, 200)));
   ```

---

## ✅ Success Criteria

You know it's working when:

1. ✅ No placeholder brackets in any response
2. ✅ Actual project names appear (Search, Zentra, LMS)
3. ✅ Specific details from PDFs are cited
4. ✅ Numbers/metrics mentioned when available
5. ✅ Responses feel complete and professional
6. ✅ Users can't tell it's template-generated

---

**If all else fails:** Share your backend logs (first 100 lines after query) for further diagnosis.
