import { ObjectId, WithId } from "mongodb";
import { getDb } from "@/lib/mongodb";

type StoredChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatSessionDoc = {
  userId: ObjectId;
  title: string;
  topicPrompt: string;
  messages: StoredChatMessage[];
  isSessionShared: boolean;
  isTopicShared: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type ChatSessionRecord = WithId<ChatSessionDoc>;

export type ChatSessionSummary = {
  id: string;
  title: string;
  topicPrompt: string;
  isSessionShared: boolean;
  isTopicShared: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type SharedTopicSummary = {
  id: string;
  title: string;
  topicPrompt: string;
  updatedAt: string;
};

function makeTitle(messages: StoredChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user")?.content.trim() ?? "New Clarify Session";
  if (firstUser.length <= 72) return firstUser;
  return `${firstUser.slice(0, 69).trim()}...`;
}

function makeTopicPrompt(messages: StoredChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user")?.content.trim() ?? "";
  if (firstUser) return firstUser;
  return "It would be great if I/We...";
}

export async function saveClarifySession(params: {
  userId: ObjectId;
  messages: StoredChatMessage[];
  sessionId?: string;
}): Promise<string> {
  const db = await getDb();
  const now = new Date();
  const title = makeTitle(params.messages);
  const topicPrompt = makeTopicPrompt(params.messages);

  if (params.sessionId) {
    const parsedId = ObjectId.isValid(params.sessionId) ? new ObjectId(params.sessionId) : null;
    if (parsedId) {
      const updateResult = await db.collection<ChatSessionDoc>("clarify_sessions").updateOne(
        { _id: parsedId, userId: params.userId },
        {
          $set: {
            title,
            topicPrompt,
            messages: params.messages,
            updatedAt: now,
          },
        },
      );

      if (updateResult.matchedCount > 0) {
        return parsedId.toHexString();
      }
    }
  }

  const insertResult = await db.collection<ChatSessionDoc>("clarify_sessions").insertOne({
    userId: params.userId,
    title,
    topicPrompt,
    messages: params.messages,
    isSessionShared: false,
    isTopicShared: false,
    createdAt: now,
    updatedAt: now,
  });

  return insertResult.insertedId.toHexString();
}

export async function listClarifySessions(userId: ObjectId): Promise<ChatSessionSummary[]> {
  const db = await getDb();
  const records = await db
    .collection<ChatSessionDoc>("clarify_sessions")
    .find({ userId })
    .sort({ updatedAt: -1 })
    .limit(100)
    .toArray();

  return records.map((record) => ({
    id: record._id.toHexString(),
    title: record.title,
    topicPrompt: record.topicPrompt || "It would be great if I/We...",
    isSessionShared: Boolean(record.isSessionShared),
    isTopicShared: Boolean(record.isTopicShared),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    messageCount: record.messages.length,
  }));
}

export async function getClarifySessionById(params: {
  userId: ObjectId;
  sessionId: string;
}): Promise<{
  id: string;
  title: string;
  topicPrompt: string;
  isSessionShared: boolean;
  isTopicShared: boolean;
  messages: StoredChatMessage[];
} | null> {
  if (!ObjectId.isValid(params.sessionId)) return null;

  const db = await getDb();
  const record = (await db.collection<ChatSessionDoc>("clarify_sessions").findOne({
    _id: new ObjectId(params.sessionId),
    userId: params.userId,
  })) as ChatSessionRecord | null;

  if (!record) return null;

  return {
    id: record._id.toHexString(),
    title: record.title,
    topicPrompt: record.topicPrompt || "It would be great if I/We...",
    isSessionShared: Boolean(record.isSessionShared),
    isTopicShared: Boolean(record.isTopicShared),
    messages: record.messages,
  };
}

export async function deleteClarifySession(params: {
  userId: ObjectId;
  sessionId: string;
}): Promise<boolean> {
  if (!ObjectId.isValid(params.sessionId)) return false;

  const db = await getDb();
  const result = await db.collection<ChatSessionDoc>("clarify_sessions").deleteOne({
    _id: new ObjectId(params.sessionId),
    userId: params.userId,
  });

  return result.deletedCount > 0;
}

export async function setClarifySessionSharing(params: {
  userId: ObjectId;
  sessionId: string;
  target: "session" | "topic";
  isShared: boolean;
}): Promise<boolean> {
  if (!ObjectId.isValid(params.sessionId)) return false;

  const fieldToUpdate = params.target === "topic" ? "isTopicShared" : "isSessionShared";

  const db = await getDb();
  const result = await db.collection<ChatSessionDoc>("clarify_sessions").updateOne(
    {
      _id: new ObjectId(params.sessionId),
      userId: params.userId,
    },
    {
      $set: {
        [fieldToUpdate]: params.isShared,
        updatedAt: new Date(),
      },
    },
  );

  return result.matchedCount > 0;
}

export async function listSharedTopics(): Promise<SharedTopicSummary[]> {
  const db = await getDb();
  const records = await db
    .collection<ChatSessionDoc>("clarify_sessions")
    .find({ isTopicShared: true })
    .sort({ updatedAt: -1 })
    .limit(100)
    .toArray();

  return records.map((record) => ({
    id: record._id.toHexString(),
    title: record.title,
    topicPrompt: record.topicPrompt || "It would be great if I/We...",
    updatedAt: record.updatedAt.toISOString(),
  }));
}
