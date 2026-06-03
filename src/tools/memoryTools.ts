/** memoryTools — thin facade for reply memory retrieval.
 * Most logic lives in `replyMemoryService.ts`; this file is a stable
 * import surface so callers don't depend on the service directly.
 */
export {
  findFewShotExamples,
  extractKeywords,
  type IFewShotExample,
  type IFewShotQuery,
} from "../services/replyMemoryService.js";
