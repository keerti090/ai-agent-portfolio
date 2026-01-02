# Training Your AI Agent to Avoid Vague Responses

## The Problem

Your agent (Kairo) was responding with generic, placeholder-filled answers like:

> "I'm excited to share that Keerti's latest case study focuses on **[insert project name or brief description here]**."

This happens because the AI isn't properly trained to:
1. Extract specific information from the context
2. Avoid using placeholder templates
3. Cite concrete details from the PDFs

---

## The Solution: Multi-Layer Training

### 1. **System Prompt Training** (`backend/systemprompt.ts`)

The system prompt now includes:

#### Critical Rules Section
- Explicitly forbids placeholder text
- Demands specific information extraction
- Requires citing actual data from context
- Only allows "I don't have that detail" when info is genuinely missing

#### Good vs. Bad Examples
Shows the AI exactly what responses look like:

**GOOD:**
> "Keerti's latest case study is the **Search Global & Module** project for Optym. She redesigned the search experience..."

**BAD:** 
> "Keerti's latest case study focuses on [insert project name]..."

#### Forbidden List
Explicitly lists prohibited patterns:
- Brackets like `[describe X]`
- Vague phrases without specifics
- Any placeholder text
- Making up information

---

### 2. **User Message Reinforcement** (`backend/server.ts`)

The user message to the AI now:
- Repeats the specificity requirement
- Instructs to extract actual names, numbers, outcomes
- Reminds to avoid vague language
- Emphasizes using real data from context

---

### 3. **Temperature Adjustment**

Increased from `0.3` to `0.5` to allow for:
- More natural language
- Better extraction of specific details
- Less templated responses

---

## How to Test the Changes

1. **Restart your backend server:**
   ```bash
   cd /workspace/backend
   npm run dev
   ```

2. **Test with these prompts:**
   - "Show Keerti's latest case study"
   - "What projects has Keerti worked on?"
   - "Tell me about Keerti's design process"
   - "What was the impact of her work?"

3. **What to look for:**
   - ✅ Actual project names (Search Global & Module, Zentra, LMS)
   - ✅ Specific numbers/metrics from PDFs
   - ✅ Concrete design methodologies
   - ✅ Real tools and technologies mentioned
   - ❌ No brackets or placeholder text
   - ❌ No generic "showcased skills" language

---

## Additional Training Tips

### A. Improve Your Vector Search
If responses are still vague, the issue might be context retrieval:

```typescript
// In server.ts, increase search results:
const searchResults = await vectorstore.similaritySearchWithScore(trimmedMessage, 8);
// Changed from 5 to 8 for more context
```

### B. Increase Chunk Size for Better Context
```typescript
// In server.ts, provide more context per chunk:
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 2000,  // Increased from 1200
  chunkOverlap: 400, // Increased from 200
});
```

### C. Add Response Validation
Add a post-processing check to catch placeholders:

```typescript
// After getting the answer:
if (answer.includes('[') && answer.includes(']')) {
  console.warn('⚠️ Detected placeholder text in response!');
  // Could trigger a retry or log for review
}
```

### D. Log Context Quality
Monitor what context the AI receives:

```typescript
// Already in server.ts at line 274:
console.log("🧠 FINAL CONTEXT SENT TO LLM:\n", context.slice(0, 2000));
```

Check these logs to ensure:
- Context contains actual case study content
- Not just metadata or generic text
- Includes specific details from PDFs

---

## Maintenance & Iteration

### Monitor for Regression
- Periodically test with the same prompts
- Keep a log of problematic responses
- Update system prompt with new forbidden patterns

### Update Examples
As you add more case studies:
1. Add real examples from them to `systemprompt.ts`
2. Show both good and bad responses for each project type

### Version Your Prompts
Consider tracking system prompt changes:
```typescript
export const SYSTEM_PROMPT_VERSION = "2.0.0";
export const systemprompt = `...`;
```

---

## Summary of Changes Made

| File | Change | Purpose |
|------|--------|---------|
| `backend/systemprompt.ts` | Complete rewrite with critical rules | Explicitly train against vague responses |
| `backend/server.ts` | Enhanced user message prompt | Reinforce specificity in context |
| `backend/server.ts` | Temperature 0.3 → 0.5 | Allow more natural, detailed responses |

---

## Expected Results

**Before:**
- Placeholder text like "[insert name]"
- Generic descriptions
- No concrete details

**After:**
- Actual project names from PDFs
- Specific metrics and outcomes
- Concrete design processes
- Real tools and methodologies
- Only says "I don't have that detail" when truly missing

---

## Troubleshooting

### Still getting vague responses?

1. **Check PDF loading:**
   ```bash
   # Look for "RAW DOC COUNT" in server logs
   # Should show 3 PDFs loaded
   ```

2. **Verify embeddings:**
   ```bash
   # Check "TOTAL SPLIT CHUNKS" in logs
   # Should be 50+ chunks
   ```

3. **Inspect context quality:**
   ```bash
   # Check "FINAL CONTEXT SENT TO LLM" logs
   # Should contain actual case study text, not just titles
   ```

4. **Try a different model:**
   ```typescript
   model: "gpt-4o", // More expensive but better at following instructions
   ```

---

## Next Steps

1. Test the changes with various prompts
2. Monitor the logs for context quality
3. Iterate on the system prompt based on actual responses
4. Consider adding response validation/post-processing
5. Build a test suite with expected specific responses

---

**Remember:** AI training is iterative. Keep refining the system prompt with real examples of bad responses you want to prevent!
