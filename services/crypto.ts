/**
 * CRYPTO SERVICE
 * 
 * In a real-world scenario, this would handle E2EE using Signal Protocol or similar.
 * Since the provided API spec is "encryption-agnostic" and stores ciphertext/iv,
 * but doesn't explicitly provide endpoints for public key distribution in the 
 * conversation list flow, we will implement a standard AES-GCM encryption
 * using a shared demo key or derived keys to demonstrate the functionality.
 */

// Simple string to buffer
const str2ab = (str: string): ArrayBuffer => {
  const buf = new ArrayBuffer(str.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
};

// Simple buffer to string
const ab2str = (buf: ArrayBuffer): string => {
  return String.fromCharCode.apply(null, Array.from(new Uint8Array(buf)));
};

// Convert ArrayBuffer to Base64
const ab2base64 = (buf: ArrayBuffer): string => {
  return btoa(ab2str(buf));
};

// Convert Base64 to ArrayBuffer
const base642ab = (base64: string): ArrayBuffer => {
  return str2ab(atob(base64));
};

const getDemoKey = async (): Promise<CryptoKey> => {
  const rawKey = str2ab("kapsel-demo-key-1234567890123456"); // 32 bytes mock
  return window.crypto.subtle.importKey(
    "raw",
    rawKey,
    "AES-GCM",
    true,
    ["encrypt", "decrypt"]
  );
};

export const encryptMessage = async (text: string): Promise<{ ciphertext: string; iv: string }> => {
  try {
    const key = await getDemoKey();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encodedText = new TextEncoder().encode(text);

    const encryptedContent = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      encodedText
    );

    return {
      ciphertext: ab2base64(encryptedContent),
      iv: ab2base64(iv.buffer as ArrayBuffer),
    };
  } catch (error) {
    console.error("Encryption failed:", error);
    throw error;
  }
};

export const decryptMessage = async (ciphertext: string, ivStr: string): Promise<string> => {
  try {
    const key = await getDemoKey();
    const iv = base642ab(ivStr);
    const encryptedData = base642ab(ciphertext);

    const decryptedContent = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(iv),
      },
      key,
      encryptedData
    );

    return new TextDecoder().decode(decryptedContent);
  } catch (error) {
    console.error("Decryption failed:", error);
    return "⚠️ Decryption Failed";
  }
};