import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";

initializeApp();
const db = getFirestore();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const passwordHash = (password: string, salt: string) =>
  scryptSync(password, salt, 64).toString("hex");

function requireAuth(request: { auth?: { uid: string } | null }) {
  if (!request.auth) throw new HttpsError("unauthenticated", "請先建立匿名登入工作階段。");
  return request.auth.uid;
}
function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export const createRoom = onCall({ region: "asia-east1", maxInstances: 10 }, async (request) => {
  const uid = requireAuth(request);
  const title = cleanText(request.data?.title, 40) || "日本旅行";
  const name = cleanText(request.data?.name, 20);
  const password = cleanText(request.data?.password, 80);
  const maxMembers = Number(request.data?.maxMembers);
  if (!name) throw new HttpsError("invalid-argument", "請輸入你的暱稱。");
  if (password.length < 6) throw new HttpsError("invalid-argument", "房間密碼至少需要 6 個字元。");
  if (![1,2,3,4].includes(maxMembers)) throw new HttpsError("invalid-argument", "人數必須為 1 至 4 人。");

  const roomRef = db.collection("rooms").doc();
  const inviteToken = randomBytes(24).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  const secretRef = roomRef.collection("private").doc("credentials");
  const batch = db.batch();
  batch.set(roomRef, {
    title, ownerUid: uid, maxMembers, rate: 0.22,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  });
  batch.set(secretRef, { inviteHash: hash(inviteToken), salt, passwordHash: passwordHash(password, salt) });
  batch.set(roomRef.collection("members").doc(uid), {
    uid, name, role: "owner", joinedAt: FieldValue.serverTimestamp()
  });
  await batch.commit();
  return { roomId: roomRef.id, inviteToken };
});

export const joinRoom = onCall({ region: "asia-east1", maxInstances: 20 }, async (request) => {
  const uid = requireAuth(request);
  const roomId = cleanText(request.data?.roomId, 100);
  const inviteToken = cleanText(request.data?.inviteToken, 200);
  const password = cleanText(request.data?.password, 80);
  const name = cleanText(request.data?.name, 20);
  if (!roomId || !inviteToken || !password || !name)
    throw new HttpsError("invalid-argument", "加入資料不完整。");

  const roomRef = db.collection("rooms").doc(roomId);
  const secretRef = roomRef.collection("private").doc("credentials");
  await db.runTransaction(async (tx) => {
    const [roomSnap, secretSnap, memberSnap] = await Promise.all([
      tx.get(roomRef), tx.get(secretRef), tx.get(roomRef.collection("members").doc(uid))
    ]);
    if (!roomSnap.exists || !secretSnap.exists) throw new HttpsError("not-found", "找不到這個旅遊房間。");
    if (memberSnap.exists) return;
    const secret = secretSnap.data()!;
    const expectedInvite = Buffer.from(String(secret.inviteHash), "hex");
    const actualInvite = Buffer.from(hash(inviteToken), "hex");
    if (expectedInvite.length !== actualInvite.length || !timingSafeEqual(expectedInvite, actualInvite))
      throw new HttpsError("permission-denied", "邀請連結無效。");
    const actualPassword = passwordHash(password, String(secret.salt));
    const expectedPassword = Buffer.from(String(secret.passwordHash), "hex");
    const actual = Buffer.from(actualPassword, "hex");
    if (expectedPassword.length !== actual.length || !timingSafeEqual(expectedPassword, actual))
      throw new HttpsError("permission-denied", "房間密碼錯誤。");
    const members = await tx.get(roomRef.collection("members"));
    const maxMembers = Number(roomSnap.data()?.maxMembers || 4);
    if (members.size >= maxMembers) throw new HttpsError("resource-exhausted", "這個房間的人數已滿。");
    tx.set(roomRef.collection("members").doc(uid), {
      uid, name, role: "member", joinedAt: FieldValue.serverTimestamp()
    });
  });
  return { roomId };
});