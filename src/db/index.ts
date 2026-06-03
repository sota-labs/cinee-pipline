/** Database layer — Mongoose models + connection. */
export { connectDb, disconnectDb } from "./connection.js";
export { Post, EPostStatus } from "./models/Post.js";
export { Task, ETaskStatus, ETaskType } from "./models/Task.js";
export type { ITask } from "./models/Task.js";
export { Reply } from "./models/Reply.js";
export { CurationSource, ECurationStatus, ECurationMediaType } from "./models/CurationSource.js";
export { Interaction } from "./models/Interaction.js";
export { PriorityAccount, ERelationshipTier } from "./models/PriorityAccount.js";
export { TopicConfig } from "./models/TopicConfig.js";

// KOL Engagement Models
export { KolProfile } from "./models/KolProfile.js";
export { KolPost, EKolPostStatus, ESentiment } from "./models/KolPost.js";
export { KolReplySuggestion, EReplyMode, EReplyExecutionStatus, EAdminDecision } from "./models/KolReplySuggestion.js";
export { KolReputationCache, EReputationRecommendation } from "./models/KolReputationCache.js";
export { SelfReplyQueue, EQueueStatus, ECommentStatus } from "./models/SelfReplyQueue.js";
export { KolSettings } from "./models/KolSettings.js";

// Types
export type { ICurationSource } from "./models/CurationSource.js";
export type { IPriorityAccount } from "./models/PriorityAccount.js";
export type { IInteraction } from "./models/Interaction.js";
export type { IPost, IMedia, IVideoDetails, IEditEntry } from "./models/Post.js";
export type { IKolProfile } from "./models/KolProfile.js";
export type { IKolPost, ITopComment, IEngagementPattern, IAnalysisResult } from "./models/KolPost.js";
export type { IKolReplySuggestion, ISuggestion } from "./models/KolReplySuggestion.js";
export type { IKolReputationCache, IReputationMetrics } from "./models/KolReputationCache.js";
export type { ISelfReplyQueue, IPendingComment } from "./models/SelfReplyQueue.js";
export type { IKolSettings, IAFKSettings, IManualSettings, ISelfReplySettings, ISafetySettings, ITierCrawlIntervals } from "./models/KolSettings.js";
export { EReplyStatus as ReplyStatus, EReplyTone as ReplyTone, EReplyPlatform as ReplyPlatform } from "./models/Reply.js";
export type { IReply } from "./models/Reply.js";
export type { ITopicConfig } from "./models/TopicConfig.js";
