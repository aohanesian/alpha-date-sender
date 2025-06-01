# 🔍 Processing Loop Analysis

## Overview

Both chat and mail processing functions implement identical infinite loop architectures with the same features, error handling, and exit conditions. **NEW: Both functions now implement full pagination to fetch all available chats/mail items across multiple pages.**

## 🔄 **Infinite Loop Structure**

### **Common Features (Both Chat & Mail)**
- ✅ **Infinite while(true) loop**
- ✅ **Cycle counting and tracking**
- ✅ **Manual stop detection**
- ✅ **Critical HTTP error handling (401, 400, 429)**
- ✅ **Non-critical error retry logic**
- ✅ **5-second delays between cycles**
- ✅ **Cumulative statistics tracking**
- ✅ **Blocklist optimization**
- ✅ **Real-time progress updates**
- ✅ **🆕 Full pagination support - fetches ALL pages until empty response**

## 📄 **Pagination Implementation**

### **How Pagination Works**
1. **Start with page 1** and increment for each subsequent request
2. **Continue fetching** until server returns `{"status": true, "response": []}`
3. **Combine all pages** into a single collection for processing
4. **500ms delay** between page requests to avoid rate limiting
5. **Real-time progress** shows current page being fetched

### **Pagination Logic**
```typescript
const allItems = [];
let currentPage = 1;
let hasMorePages = true;

while (hasMorePages) {
  // Fetch page with current page number
  const payload = { ...basePayload, page: currentPage };
  const response = await fetchPage(payload);
  
  // Check if page is empty (no more items)
  if (response.data.response.length === 0) {
    hasMorePages = false;
  } else {
    allItems.push(...response.data.response);
    currentPage++;
    await delay(500); // Rate limiting protection
  }
}
```

## 📡 **API Endpoints & Payloads**

### **Chat Processing**

#### **1. Fetch Chats (All Pages)**
- **Endpoint**: `POST https://alpha.date/api/chatList/chatListByUserID`
- **Payload** (per page):
```json
{
  "user_id": "profileId",
  "chat_uid": false,
  "page": 1, // Increments: 1, 2, 3, ... until empty response
  "freeze": true,
  "limits": null,
  "ONLINE_STATUS": 1,
  "SEARCH": "",
  "CHAT_TYPE": "CHANCE"
}
```

#### **2. Get Chat History**
- **Endpoint**: `POST https://alpha.date/api/chatList/chatHistory`
- **Payload**:
```json
{
  "chat_id": "chat.chat_uid",
  "page": 1
}
```

#### **3. Send Chat Message**
- **Endpoint**: `POST https://alpha.date/api/chat/message`
- **Payload**:
```json
{
  "sender_id": "profileId",
  "recipient_id": "recipientId",
  "message_content": "message",
  "message_type": "SENT_TEXT",
  "filename": "",
  "chance": true
}
```

### **Mail Processing**

#### **1. Fetch Mail Items (All Pages)**
- **Endpoint**: `POST https://alpha.date/api/chatList/chatListByUserID`
- **Payload** (per page):
```json
{
  "user_id": "profileId",
  "chat_uid": false,
  "page": 1, // Increments: 1, 2, 3, ... until empty response
  "freeze": true,
  "limits": null,
  "ONLINE_STATUS": 1,
  "SEARCH": "",
  "CHAT_TYPE": "CHANCE"
}
```

#### **2. Create Draft**
- **Endpoint**: `POST https://alpha.date/api/mailbox/adddraft`
- **Payload**:
```json
{
  "user_id": "profileId",
  "recipients": ["mail.recipient_external_id"],
  "message_content": "message",
  "attachments": []
}
```

#### **3. Send Mail**
- **Endpoint**: `POST https://alpha.date/api/mailbox/mail`
- **Payload**:
```json
{
  "user_id": "profileId",
  "recipients": ["mail.recipient_external_id"],
  "message_content": "message",
  "message_type": "SENT_TEXT",
  "attachments": [],
  "parent_mail_id": null,
  "is_send_email": false
}
```

#### **4. Delete Draft**
- **Endpoint**: `POST https://alpha.date/api/mailbox/deletedraft`
- **Payload**:
```json
{
  "user_id": "profileId",
  "draft_ids": ["draftId"]
}
```

## 🚫 **Blocklist System**

### **Common Implementation (Both Chat & Mail)**
- ✅ **Pre-load entire blocklist** for O(1) lookups
- ✅ **JavaScript Set for fast filtering**
- ✅ **Mark as sent regardless of success/failure**
- ✅ **MD5 message hash for tracking**
- ✅ **30-day Redis expiration**
- ✅ **Performance timing logs**

### **Blocklist Keys**
- **Chat**: `sent:{operatorId}:{profileId}:{recipientId}:chat`
- **Mail**: `sent:{operatorId}:{profileId}:{recipientId}:mail`

## ⚠️ **Exit Conditions**

### **1. Manual Stop**
```typescript
const currentState = await sessionManager.getProcessingStatus(operatorId, profileId, type);
if (!currentState || !currentState.isProcessing) {
  console.log(`⏹️ Processing stopped by user`);
  break;
}
```

### **2. Critical HTTP Errors**
```typescript
if (response.status === 401 || response.status === 400 || response.status === 429) {
  console.error(`❌ Critical HTTP error ${response.status}`);
  throw new Error(`Critical HTTP error: ${response.status}`);
}
```

### **3. Critical Error Types**
- **401 Unauthorized**: Invalid/expired token
- **400 Bad Request**: Invalid request format
- **429 Rate Limited**: Too many requests

## 🔄 **Error Handling**

### **Critical Errors (Stop Processing)**
- ✅ **HTTP 401, 400, 429**
- ✅ **Immediate loop termination**
- ✅ **Error message to user**
- ✅ **Processing state cleanup**

### **Non-Critical Errors (Retry)**
- ✅ **HTTP 5xx, network errors**
- ✅ **5-second wait before retry**
- ✅ **Continue to next cycle**
- ✅ **Retry message to user**

### **Individual Message Errors**
- ✅ **Mark as sent to prevent retries**
- ✅ **Increment failed counter**
- ✅ **Continue processing other messages**
- ✅ **Log error details**

## 📊 **Statistics Tracking**

### **Per-Cycle Stats**
```typescript
let sentCount = 0;      // Messages sent this cycle
let skippedCount = 0;   // Recipients already contacted
let failedCount = 0;    // Failed to send this cycle
```

### **Cumulative Stats**
```typescript
let totalSent = 0;      // Total sent across all cycles
let totalSkipped = 0;   // Total skipped across all cycles
let totalFailed = 0;    // Total failed across all cycles
```

### **Progress Updates**
- ✅ **Real-time cycle progress**
- ✅ **🆕 Page fetching progress** (`Fetching page 1...`, `Fetching page 2...`)
- ✅ **Individual message processing**
- ✅ **Cycle completion summaries**
- ✅ **Final completion statistics**

## 🎯 **Message Processing Logic**

### **Chat Processing**
1. **🆕 Fetch all chat pages** from Alpha Date API (pagination until empty)
2. **Get chat history** to find recipient for each chat
3. **Extract recipient** from last message
4. **Check blocklist** for duplicate prevention
5. **Send message** via chat API
6. **Mark as sent** in blocklist

### **Mail Processing**
1. **🆕 Fetch all mail pages** from Alpha Date API (pagination until empty)
2. **Extract recipient** directly from mail object
3. **Check blocklist** for duplicate prevention
4. **Create draft** via mailbox API
5. **Send mail** via mailbox API
6. **Delete draft** to clean up
7. **Mark as sent** in blocklist

## ⏱️ **Timing Configuration**

### **Delays**
```typescript
const CYCLE_DELAY = 5000;     // 5 seconds between cycles
const MESSAGE_DELAY = 1000;   // 1 second between messages
const RETRY_DELAY = 5000;     // 5 seconds on errors
const PAGE_DELAY = 500;       // 🆕 500ms between page requests
```

### **Performance Metrics**
- ✅ **Blocklist load timing**
- ✅ **Processing speed tracking**
- ✅ **Cycle duration logging**
- ✅ **API response times**
- ✅ **🆕 Pagination timing** (pages fetched per cycle)

## 🔧 **Feature Parity Verification**

### **✅ Chat Processing Has:**
- Infinite loop with cycle counting
- Manual stop detection
- Critical HTTP error handling (401, 400, 429)
- Non-critical error retry logic
- Blocklist optimization
- Statistics tracking
- Progress updates
- 5-second cycle delays
- 1-second message delays
- **🆕 Full pagination support**

### **✅ Mail Processing Has:**
- Infinite loop with cycle counting
- Manual stop detection
- Critical HTTP error handling (401, 400, 429)
- Non-critical error retry logic
- Blocklist optimization
- Statistics tracking
- Progress updates
- 5-second cycle delays
- 1-second message delays
- **🆕 Full pagination support**

## 🎉 **Conclusion**

Both chat and mail processing functions have **identical feature sets** including the new pagination functionality:

1. **Same infinite loop structure**
2. **Same error handling logic**
3. **Same exit conditions**
4. **Same blocklist system**
5. **Same statistics tracking**
6. **Same progress updates**
7. **Same timing configuration**
8. **Same multi-device support**
9. **🆕 Same pagination implementation** - fetches ALL pages until empty response

The only differences are the specific API endpoints and payloads used for each message type, which is expected and correct for their respective functionalities.

---

**🎯 Both processing loops are feature-complete, functionally equivalent, and now fetch ALL available data via pagination!** 

### **🆕 Pagination Benefits**
- **Complete Coverage**: No more missed chats/mail on subsequent pages
- **Automatic Detection**: Stops when server returns empty response
- **Rate Limiting Protection**: 500ms delays between page requests
- **Real-Time Feedback**: Shows current page being fetched
- **Error Handling**: Same critical/non-critical error logic applies to pagination