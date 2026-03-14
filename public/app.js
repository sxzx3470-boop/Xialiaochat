// 全局变量
let currentUser = null;
let currentChat = null;
let socket = null;
let friendRequests = []; // 存储好友请求
let friendRemarks = {}; // 存储好友备注 {username: remark}
let friendsData = {}; // 存储好友数据 {username: {avatar, ...}}

// Socket.IO 连接
function connectSocket() {
  socket = io();
  
  socket.on('connect', () => {
    console.log('已连接到服务器');
    socket.emit('user-online', { username: currentUser.username });
  });
  
  socket.on('receive-message', (message) => {
    if (currentChat && message.from === currentChat) {
      // 当前正在聊天，直接显示消息
      addMessageToUI(message);
      // 标记为已读
      socket.emit('mark-read', { from: message.from, to: currentUser.username });
    } else {
      // 不在聊天界面，显示通知
      showChatMessage(`📨 ${message.from} 发来新消息`);
      // 更新该好友的未读角标
      updateFriendUnreadBadge(message.from, message.unreadCount || 1);
    }
  });
  
  socket.on('message-sent', (message) => {
    // 发送成功，显示消息
    addMessageToUI(message);
  });
  
  socket.on('friend-request', (data) => {
    // 添加到好友请求列表
    friendRequests.push(data);
    updateRequestBadge();
    // 显示顶部通知，不显示弹窗
    showChatMessage(`📬 ${data.fromUsername} 请求添加你为好友`);
    // 如果在通讯录标签页，刷新列表
    if (document.getElementById('contacts-tab').style.display !== 'none') {
      renderFriendRequests();
    }
  });
  
  socket.on('friend-added', (data) => {
    // 检查是否已存在
    const existingLi = document.querySelector(`#friends-list li[data-username="${data.friend}"]`);
    if (!existingLi) {
      addFriendToList(data.friend, data.friendUsername, data.wechatId, true);
    }
    
    showChatMessage(`✨ 已添加 ${data.friendUsername} 为好友，可以开始聊天了！`);
    
    // 自动打开聊天界面
    if (!currentChat) {
      selectFriend(data.friend);
    }
    
    // 刷新通讯录列表
    renderContactsList();
  });
  
  socket.on('friend-request-rejected', (data) => {
    // 显示顶部通知，不显示弹窗
    showChatMessage(`❌ ${data.byUsername} 拒绝了您的好友申请`);
  });
  
  // 账号被锁定
  socket.on('account-locked', (data) => {
    alert(data.message);
    logout();
  });
  
  socket.on('user-status', (data) => {
    updateFriendStatus(data.user, data.online);
  });
  
  // 好友头像更新通知
  socket.on('avatar-updated', (data) => {
    // 更新好友数据
    if (friendsData[data.username]) {
      friendsData[data.username].avatar = data.avatar;
    }
    // 刷新好友列表显示新头像
    loadFriends();
  });
  
  // 群聊创建通知
  socket.on('group-created', (group) => {
    showChatMessage(`✨ 你被拉入了新群聊：${group.name}`);
    loadGroups();
  });
  
  // 群聊成员加入通知
  socket.on('group-members-added', (data) => {
    showChatMessage(`👥 ${data.addedMembers.length} 位新成员加入了群聊`);
    if (currentGroup && currentGroup.id === data.groupId) {
      loadGroups();
    }
  });
  
  // 接收群聊消息
  socket.on('receive-group-message', (message) => {
    if (currentGroup && message.groupId === currentGroup.id) {
      addGroupMessageToUI(message);
    } else {
      const group = groupsMap.get(message.groupId);
      const groupName = group ? group.name : '群聊';
      showChatMessage(`📨 ${groupName} 有新消息`);
    }
  });

  // 群聊名称更新通知
  socket.on('group-renamed', (data) => {
    showChatMessage(`📝 群聊名称已更新为：${data.newName}`);
    
    // 如果当前正在查看该群聊，更新界面
    if (currentGroup && currentGroup.id === data.groupId) {
      currentGroup.name = data.newName;
      document.getElementById('group-chat-name').textContent = data.newName;
    }
    
    // 更新 groupsMap
    if (groupsMap.has(data.groupId)) {
      const group = groupsMap.get(data.groupId);
      group.name = data.newName;
    }
    
    // 刷新群聊列表
    loadGroups();
  });

  // 群聊头像更新通知
  socket.on('group-avatar-updated', (data) => {
    showChatMessage('📷 群头像已更新');
    
    // 如果当前正在查看该群聊，更新界面
    if (currentGroup && currentGroup.id === data.groupId) {
      currentGroup.avatar = data.avatarUrl;
      // 更新聊天头部的群头像
      const groupChatAvatar = document.getElementById('group-chat-avatar');
      if (groupChatAvatar) {
        groupChatAvatar.innerHTML = `<img src="${data.avatarUrl}?t=${Date.now()}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 5px;">`;
      }
    }
    
    // 更新 groupsMap
    if (groupsMap.has(data.groupId)) {
      const group = groupsMap.get(data.groupId);
      group.avatar = data.avatarUrl;
    }
    
    // 刷新群聊列表
    loadGroups();
  });
}

// 显示登录界面
function showLogin() {
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('register-form').style.display = 'none';
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === 0);
  });
  clearMessage();
}

// 显示注册界面
function showRegister() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('register-form').style.display = 'block';
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === 1);
  });
  clearMessage();
}

// 显示消息（登录/注册）
function showMessage(msg, isError = false) {
  const messageEl = document.getElementById('auth-message');
  messageEl.textContent = msg;
  messageEl.className = 'message ' + (isError ? 'error' : 'success');
  messageEl.style.display = 'block';
  
  setTimeout(() => {
    messageEl.style.display = 'none';
  }, 3000);
}

// 显示聊天消息通知
function showChatMessage(msg, duration = 3000) {
  // 创建一个临时消息提示
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(7, 193, 96, 0.9);
    color: white;
    padding: 15px 30px;
    border-radius: 25px;
    font-size: 14px;
    z-index: 9999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function clearMessage() {
  document.getElementById('auth-message').style.display = 'none';
}

// 登录处理
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const data = await response.json();
    
    if (data.success) {
      currentUser = data.user;
      // 保存 token 到 localStorage
      localStorage.setItem('token', data.token);
      showChatInterface();
      showMessage('登录成功！账号将在 7 天后自动锁定（如果 7 天内再次登录则不会锁定）');
    } else {
      showMessage(data.message, true);
    }
  } catch (error) {
    showMessage('网络错误', true);
  }
});

// 验证密码强度
function validatePassword(password) {
  // 检查长度是否为 8 位及以上
  if (password.length < 8) {
    return {
      valid: false,
      message: '密码长度必须为 8 位及以上'
    };
  }
  
  // 检查是否包含数字
  const hasDigit = /\d/.test(password);
  if (!hasDigit) {
    return {
      valid: false,
      message: '密码必须包含数字'
    };
  }
  
  // 检查是否包含小写字母
  const hasLowercase = /[a-z]/.test(password);
  if (!hasLowercase) {
    return {
      valid: false,
      message: '密码必须包含小写字母'
    };
  }
  
  // 检查是否包含大写字母
  const hasUppercase = /[A-Z]/.test(password);
  if (!hasUppercase) {
    return {
      valid: false,
      message: '密码必须包含大写字母'
    };
  }
  
  return {
    valid: true,
    message: '密码符合要求'
  };
}

// 注册处理
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = document.getElementById('register-username').value;
  const password = document.getElementById('register-password').value;
  
  // 验证密码强度
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    showMessage(passwordValidation.message, true);
    return;
  }
  
  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const data = await response.json();
    
    if (data.success) {
      currentUser = data.user;
      // 保存 token 到 localStorage 并直接登录
      localStorage.setItem('token', data.token);
      showChatInterface();
      showMessage('注册成功，已自动登录！');
    } else {
      showMessage(data.message, true);
    }
  } catch (error) {
    showMessage('网络错误', true);
  }
});

// 显示聊天界面
function showChatInterface() {
  document.getElementById('auth-container').style.display = 'none';
  document.getElementById('chat-container').style.display = 'flex';
  
  document.getElementById('current-username').textContent = currentUser.username;
  
  // 显示用户头像
  const currentUserAvatar = document.getElementById('current-user-avatar');
  if (currentUser.avatar) {
    currentUserAvatar.innerHTML = `<img src="${currentUser.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
  } else {
    currentUserAvatar.textContent = currentUser.username[0].toUpperCase();
  }
  
  // 显示设置面板中的头像预览
  const settingsAvatarPreview = document.getElementById('settings-avatar-preview');
  if (currentUser.avatar) {
    settingsAvatarPreview.innerHTML = `<img src="${currentUser.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
  } else {
    settingsAvatarPreview.textContent = currentUser.username[0].toUpperCase();
  }
  
  // 显示微信号
  const wechatIdEl = document.getElementById('current-wechat-id');
  if (wechatIdEl) {
    wechatIdEl.textContent = `微信号：${currentUser.wechatId}`;
  }
  
  // 显示设置面板中的微信号
  document.getElementById('my-wechat-id').value = currentUser.wechatId;
  
  // 检查微信号修改时间
  checkWechatModifyTime();
  
  connectSocket();
  loadFriends();
  renderContactsList(); // 初始化时加载通讯录
  loadFriendRemarks(); // 加载好友备注
}

// 退出登录
function logout() {
  if (socket) {
    socket.disconnect();
  }
  // 清除 token
  localStorage.removeItem('token');
  currentUser = null;
  currentChat = null;
  document.getElementById('chat-container').style.display = 'none';
  document.getElementById('auth-container').style.display = 'flex';
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
}

// 加载好友列表
async function loadFriends() {
  try {
    const response = await fetch(`/api/friends/${currentUser.username}`);
    const data = await response.json();
    
    const friendsList = document.getElementById('friends-list');
    friendsList.innerHTML = '';
    
    if (data.friends && data.friends.length > 0) {
      data.friends.forEach(friend => {
        // 存储好友数据
        friendsData[friend.username] = {
          avatar: friend.avatar,
          wechatId: friend.wechatId
        };
        addFriendToList(friend.username, friend.username, friend.wechatId, friend.online, friend.avatar, friend.unreadCount);
      });
    }
  } catch (error) {
    console.error('加载好友列表失败:', error);
  }
}

// 添加好友到列表
function addFriendToList(username, displayName, wechatId = '', online = false, avatar = null, unreadCount = 0) {
  const friendsList = document.getElementById('friends-list');
  const li = document.createElement('li');
  li.dataset.username = username;
  li.onclick = () => selectFriend(username);
  
  let avatarContent = username[0].toUpperCase();
  if (avatar) {
    avatarContent = `<img src="${avatar}?t=${Date.now()}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
  }
  
  li.innerHTML = `
    <div class="avatar">${avatarContent}</div>
    <div class="friend-info">
      <span class="friend-name">${displayName}</span>
      ${wechatId ? `<span class="friend-wechat-id">${wechatId}</span>` : ''}
    </div>
    <div class="friend-right">
      <div class="friend-status ${online ? 'online' : ''}" title="${online ? '在线' : '离线'}"></div>
      ${unreadCount > 0 ? `<div class="unread-badge" title="${unreadCount}条未读消息">${unreadCount > 99 ? '99+' : unreadCount}</div>` : ''}
    </div>
  `;
  
  friendsList.appendChild(li);
}

// 更新好友状态
function updateFriendStatus(username, online) {
  const li = document.querySelector(`#friends-list li[data-username="${username}"]`);
  if (li) {
    const statusEl = li.querySelector('.friend-status');
    statusEl.classList.toggle('online', online);
    statusEl.title = online ? '在线' : '离线';
  }
}

// 更新好友未读角标
function updateFriendUnreadBadge(username, count) {
  const li = document.querySelector(`#friends-list li[data-username="${username}"]`);
  if (li) {
    let badge = li.querySelector('.unread-badge');
    
    if (count > 0) {
      if (!badge) {
        const friendRight = li.querySelector('.friend-right');
        if (friendRight) {
          badge = document.createElement('div');
          badge.className = 'unread-badge';
          friendRight.appendChild(badge);
        }
      }
      if (badge) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.title = `${count}条未读消息`;
      }
    } else {
      if (badge) {
        badge.remove();
      }
    }
  }
}

// 当前搜索的用户
let currentSearchUser = null;

// 搜索用户
async function searchUser() {
  const keyword = document.getElementById('search-user').value.trim();
  
  if (!keyword) {
    showSearchError('请输入微信号或用户名');
    return;
  }
  
  if (keyword === currentUser.username || keyword === currentUser.wechatId) {
    showSearchError('不能搜索自己');
    return;
  }
  
  try {
    const response = await fetch(`/api/search/${keyword}?searcher=${currentUser.username}`);
    const data = await response.json();
    
    if (data.success) {
      currentSearchUser = data.user;
      showSearchResult(data.user);
    } else {
      showSearchError(data.message);
    }
  } catch (error) {
    showSearchError('搜索失败');
  }
}

// 显示搜索结果
function showSearchResult(user) {
  const resultDiv = document.getElementById('search-result');
  const avatar = document.getElementById('result-avatar');
  const name = document.getElementById('result-name');
  const wechatId = document.getElementById('result-wechat-id');
  const addBtn = document.getElementById('add-friend-btn');
  
  avatar.textContent = user.username[0].toUpperCase();
  name.textContent = user.username;
  wechatId.textContent = `微信号：${user.wechatId}`;
  
  if (user.isFriend) {
    addBtn.innerHTML = '<span>✓</span> 已是好友';
    addBtn.style.background = '#ccc';
    addBtn.disabled = true;
  } else {
    addBtn.innerHTML = '<span>+</span> 添加好友';
    addBtn.style.background = '#07c160';
    addBtn.disabled = false;
  }
  
  resultDiv.style.display = 'block';
}

// 显示搜索错误
function showSearchError(message) {
  const resultDiv = document.getElementById('search-result');
  const avatar = document.getElementById('result-avatar');
  const name = document.getElementById('result-name');
  const wechatId = document.getElementById('result-wechat-id');
  const addBtn = document.getElementById('add-friend-btn');
  
  avatar.textContent = '✕';
  avatar.style.background = '#ff4d4f';
  name.textContent = '搜索失败';
  wechatId.textContent = message;
  addBtn.style.display = 'none';
  
  resultDiv.style.display = 'block';
  
  // 3 秒后自动隐藏
  setTimeout(() => {
    closeSearchResult();
  }, 3000);
}

// 关闭搜索结果
function closeSearchResult() {
  document.getElementById('search-result').style.display = 'none';
  currentSearchUser = null;
}

// 发送添加好友请求
async function sendAddRequest() {
  if (!currentSearchUser) return;
  
  await sendFriendRequest(currentSearchUser.username);
  
  // 关闭搜索结果
  closeSearchResult();
}

// 发送好友请求
async function sendFriendRequest(to) {
  try {
    const response = await fetch('/api/friend-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: currentUser.username, to })
    });
    
    const data = await response.json();
    if (data.success) {
      // 显示顶部通知
      showChatMessage(`📨 好友请求已发送，等待 ${to} 同意`);
      // 关闭搜索结果
      closeSearchResult();
    } else {
      showChatMessage(`❌ ${data.message}`);
    }
  } catch (error) {
    showChatMessage('❌ 发送好友请求失败');
  }
}



// 选择好友聊天
function selectFriend(username) {
  // 移除之前的选中状态
  document.querySelectorAll('#friends-list li').forEach(li => {
    li.classList.remove('active');
  });
  
  // 添加新的选中状态
  const selectedLi = document.querySelector(`#friends-list li[data-username="${username}"]`);
  if (selectedLi) {
    selectedLi.classList.add('active');
  }
  
  currentChat = username;
  currentGroup = null;
  
  // 隐藏无聊天提示和群聊界面
  document.getElementById('no-chat').style.display = 'none';
  document.getElementById('group-chat-box').style.display = 'none';
  document.getElementById('chat-box').style.display = 'flex';
  
  // 使用备注显示名称
  const displayName = getDisplayName(username);
  document.getElementById('chat-with-name').textContent = displayName;
  document.getElementById('chat-with-avatar').textContent = displayName[0].toUpperCase();
  
  // 更新备注显示
  updateChatHeader();
  
  // 标记消息为已读
  socket.emit('mark-read', { from: username, to: currentUser.username });
  
  // 移除该好友的未读角标
  if (selectedLi) {
    const badge = selectedLi.querySelector('.unread-badge');
    if (badge) {
      badge.remove();
    }
  }
  
  // 加载聊天记录
  loadMessages(username);
}

// 加载聊天记录
function loadMessages(username) {
  // 先清空消息区域
  const messagesEl = document.getElementById('messages');
  messagesEl.innerHTML = '';
  
  // 显示加载中
  messagesEl.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">加载中...</div>';
  
  socket.emit('get-messages', { user1: currentUser.username, user2: username }, (messages) => {
    messagesEl.innerHTML = '';
    
    if (!messages || messages.length === 0) {
      messagesEl.innerHTML = '<div style="text-align: center; color: #ccc; padding: 40px;">暂无消息，打个招呼吧~</div>';
      return;
    }
    
    messages.forEach(message => {
      addMessageToUI(message);
    });
    
    // 滚动到底部
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

// 添加消息到 UI
function addMessageToUI(message) {
  const messagesEl = document.getElementById('messages');
  
  // 移除"加载中"或"暂无消息"提示
  const loadingDiv = messagesEl.querySelector('div[style*="text-align: center"]');
  if (loadingDiv) {
    loadingDiv.remove();
  }
  
  const isSent = message.from === currentUser.username;
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
  messageDiv.style.animation = 'message-fade-in 0.3s ease-out';
  
  // 获取头像内容
  let avatarContent = '';
  if (isSent && currentUser.avatar) {
    avatarContent = `<img src="${currentUser.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`;
  } else if (!isSent && friendsData[message.from] && friendsData[message.from].avatar) {
    // 好友头像，添加时间戳防止缓存
    avatarContent = `<img src="${friendsData[message.from].avatar}?t=${Date.now()}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`;
  } else {
    avatarContent = message.from[0].toUpperCase();
  }
  
  const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  
  // 检查消息类型
  let messageContent = '';
  if (message.type === 'image') {
    messageContent = `<img src="${escapeHtml(message.content)}" alt="图片" onclick="viewImage(this.src)" style="cursor: pointer;">`;
  } else if (message.type === 'video') {
    messageContent = `<div style="position: relative; cursor: pointer;" onclick="viewVideo('${escapeHtml(message.content)}')">
      <video src="${escapeHtml(message.content)}" style="pointer-events: none; max-width: 300px;"></video>
      <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 60px; height: 60px; background: rgba(0,0,0,0.6); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
        <div style="width: 0; height: 0; border-left: 20px solid white; border-top: 12px solid transparent; border-bottom: 12px solid transparent; margin-left: 5px;"></div>
      </div>
    </div>`;
  } else if (message.type === 'emoji') {
    // 使用 Twemoji 解析表情 - 配置正确的 CDN 路径
    const parsedEmoji = twemoji.parse(message.content, {
      base: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/',
      folder: 'svg',
      ext: '.svg',
      attributes: () => ({
        class: 'emoji',
        style: 'width: 32px; height: 32px; vertical-align: middle; display: inline-block;'
      })
    });
    messageContent = `<span style="display: inline-block; line-height: 1.2;">${parsedEmoji}</span>`;
  } else {
    // 普通文本也使用 Twemoji 解析其中的表情
    const textContent = escapeHtml(message.content);
    const tempDiv = document.createElement('div');
    tempDiv.textContent = textContent;
    const parsedText = twemoji.parse(tempDiv.innerHTML, {
      base: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/',
      folder: 'svg',
      ext: '.svg',
      attributes: () => ({
        class: 'emoji small',
        style: 'width: 20px; height: 20px; vertical-align: middle; margin: 0 2px; display: inline-block;'
      })
    });
    messageContent = parsedText;
  }
  
  // 统一布局：仿微信布局，头像在消息气泡旁边
  if (isSent) {
    // 自己发送的消息：消息在左，头像在右，时间在头像下方
    messageDiv.innerHTML = `
      <div class="message-content">${messageContent}</div>
      <div class="message-wrapper">
        <div class="message-avatar">${avatarContent}</div>
        <div class="message-time">${time}</div>
      </div>
    `;
  } else {
    // 别人发送的消息：头像在左，消息在右，时间在头像下方
    messageDiv.innerHTML = `
      <div class="message-wrapper">
        <div class="message-avatar">${avatarContent}</div>
        <div class="message-time">${time}</div>
      </div>
      <div class="message-content">${messageContent}</div>
    `;
  }
  
  messagesEl.appendChild(messageDiv);
  
  // 平滑滚动到底部
  messagesEl.scrollTo({
    top: messagesEl.scrollHeight,
    behavior: 'smooth'
  });
}

// 查看大图
function viewImage(src) {
  // 创建全屏查看器
  const viewer = document.createElement('div');
  viewer.id = 'image-viewer';
  viewer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.9);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  `;
  
  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = `
    max-width: 90%;
    max-height: 90%;
    object-fit: contain;
  `;
  
  viewer.appendChild(img);
  document.body.appendChild(viewer);
  
  // 点击关闭
  viewer.onclick = () => {
    document.body.removeChild(viewer);
  };
}

// 查看视频
function viewVideo(src) {
  // 创建全屏查看器
  const viewer = document.createElement('div');
  viewer.id = 'video-viewer';
  viewer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.9);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  `;
  
  const video = document.createElement('video');
  video.src = src;
  video.controls = true;
  video.autoplay = true;
  video.style.cssText = `
    max-width: 90%;
    max-height: 90%;
  `;
  
  viewer.appendChild(video);
  document.body.appendChild(viewer);
  
  // 点击关闭（除了视频区域）
  viewer.onclick = (e) => {
    if (e.target === viewer) {
      document.body.removeChild(viewer);
    }
  };
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 检测是否为纯表情消息
function isPureEmoji(text) {
  // 匹配 Emoji 的正则表达式
  const emojiRegex = /^[\p{Emoji}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Emoji_Modifier_Base}\p{Emoji_Component}]+$/u;
  return emojiRegex.test(text.trim());
}

// 发送消息
async function sendMessage() {
  const input = document.getElementById('message-content');
  const content = input.value.trim();
  
  if (!content && !window.selectedFile) return;
  
  if (window.selectedFile) {
    // 发送文件（图片/视频）
    await sendFileMessage(window.selectedFile);
    window.selectedFile = null;
    document.getElementById('file-input').value = '';
  } else {
    // 判断消息类型
    const messageType = isPureEmoji(content) ? 'emoji' : 'text';
    
    // 发送消息
    const message = {
      from: currentUser.username,
      to: currentChat,
      content: content,
      type: messageType,
      timestamp: new Date().toISOString()
    };
    
    socket.emit('send-message', message);
  }
  
  input.value = '';
  input.focus();
}

// 处理文件选择
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  // 检查文件类型
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  
  if (!isImage && !isVideo) {
    showChatMessage('❌ 只能发送图片或视频文件');
    return;
  }
  
  // 检查文件大小（限制 2GB）
  const maxSize = 2 * 1024 * 1024 * 1024;
  if (file.size > maxSize) {
    showChatMessage('❌ 文件大小不能超过 2GB');
    return;
  }
  
  window.selectedFile = file;
  
  // 显示预览并发送
  showFilePreview(file);
}

// 显示文件预览并发送
async function showFilePreview(file) {
  // 先上传文件到服务器
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();
    
    if (data.success) {
      // 根据 mimeType 判断文件类型
      const isImage = data.mimeType.startsWith('image/');
      const fileType = isImage ? 'image' : 'video';
      
      // 上传成功，发送消息（只发送 URL）
      const message = {
        from: currentUser.username,
        to: currentChat,
        content: data.url,  // 使用正确的字段名
        type: fileType,
        fileName: data.fileName,
        fileSize: data.fileSize,
        timestamp: new Date().toISOString()
      };
      
      socket.emit('send-message', message);
      
      showChatMessage(`✓ ${isImage ? '图片' : '视频'} 已发送`);
    } else {
      showChatMessage('❌ ' + (data.error || '上传失败'));
    }
  } catch (error) {
    console.error('上传失败:', error);
    showChatMessage('❌ 上传失败，请重试');
  }
}

// 回车发送消息
function handleKeyPress(event) {
  if (event.key === 'Enter') {
    sendMessage();
  }
}

// 标签页切换
function showTab(tabName) {
  const chatTab = document.getElementById('chat-tab');
  const groupsTab = document.getElementById('groups-tab');
  const contactsTab = document.getElementById('contacts-tab');
  const tabs = document.querySelectorAll('.nav-tab');
  
  // 隐藏所有标签
  chatTab.style.display = 'none';
  groupsTab.style.display = 'none';
  contactsTab.style.display = 'none';
  tabs.forEach(tab => tab.classList.remove('active'));
  
  if (tabName === 'chat') {
    chatTab.style.display = 'block';
    tabs[0].classList.add('active');
  } else if (tabName === 'groups') {
    groupsTab.style.display = 'block';
    tabs[1].classList.add('active');
    loadGroups();
  } else if (tabName === 'contacts') {
    contactsTab.style.display = 'block';
    tabs[2].classList.add('active');
    renderFriendRequests();
    renderContactsList();
  }
}

// 更新请求徽章
function updateRequestBadge() {
  // 更新通讯录内的徽章
  const badge = document.getElementById('request-badge');
  if (friendRequests.length > 0) {
    badge.textContent = friendRequests.length;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
  
  // 更新通讯录标签上的角标
  const tabBadge = document.getElementById('contacts-badge');
  if (friendRequests.length > 0) {
    tabBadge.textContent = friendRequests.length > 99 ? '99+' : friendRequests.length;
    tabBadge.style.display = 'inline-block';
  } else {
    tabBadge.style.display = 'none';
  }
}

// 渲染好友请求列表
function renderFriendRequests() {
  const list = document.getElementById('friend-requests-list');
  list.innerHTML = '';
  
  if (friendRequests.length === 0) {
    list.innerHTML = '<li style="text-align: center; color: #999; padding: 20px;">暂无好友请求</li>';
    return;
  }
  
  friendRequests.forEach((request, index) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="request-info">
        <div class="avatar" style="width: 35px; height: 35px; font-size: 14px;">${request.fromUsername[0].toUpperCase()}</div>
        <div>
          <div style="font-weight: 500;">${request.fromUsername}</div>
          <div style="font-size: 12px; color: #999;">请求添加你为好友</div>
        </div>
      </div>
      <div class="request-actions">
        <button class="accept-btn" onclick="acceptRequest(${index})" title="接受">✓</button>
        <button class="reject-btn" onclick="rejectRequest(${index})" title="拒绝">✗</button>
      </div>
    `;
    list.appendChild(li);
  });
}

// 渲染通讯录列表
async function renderContactsList() {
  const list = document.getElementById('contacts-list');
  const countEl = document.getElementById('friend-count');
  list.innerHTML = '';
  
  try {
    // 从服务器获取最新的好友列表
    const response = await fetch(`/api/friends/${currentUser.username}`);
    const data = await response.json();
    
    if (!data.friends || data.friends.length === 0) {
      list.innerHTML = '<li style="text-align: center; color: #999; padding: 20px;">暂无好友，快去添加吧！</li>';
      countEl.textContent = '0 人';
      return;
    }
    
    countEl.textContent = `${data.friends.length}人`;
    
    // 按字母顺序排序
    const sortedFriends = data.friends.sort((a, b) => a.username.localeCompare(b.username));
    
    sortedFriends.forEach(friend => {
      const li = document.createElement('li');
      li.dataset.username = friend.username;
      li.onclick = () => {
        showTab('chat');
        selectFriend(friend.username);
      };
      
      li.innerHTML = `
        <div class="avatar">${friend.username[0].toUpperCase()}</div>
        <div class="friend-info">
          <span class="friend-name">${friend.username}</span>
          ${friend.wechatId ? `<span class="friend-wechat-id">微信号：${friend.wechatId}</span>` : ''}
        </div>
        <div class="friend-status ${friend.online ? 'online' : ''}" title="${friend.online ? '在线' : '离线'}"></div>
      `;
      
      list.appendChild(li);
    });
  } catch (error) {
    console.error('加载通讯录失败:', error);
    list.innerHTML = '<li style="text-align: center; color: #999; padding: 20px;">加载失败</li>';
    countEl.textContent = '0 人';
  }
}

// 接受好友请求（从通讯录列表）
async function acceptRequest(index) {
  const request = friendRequests[index];
  
  try {
    const response = await fetch('/api/friend-request/response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: request.from,
        to: currentUser.username,
        accept: true
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // 从请求列表中移除
      friendRequests.splice(index, 1);
      updateRequestBadge();
      renderFriendRequests();
      // 刷新通讯录
      renderContactsList();
      // 显示通知
      showChatMessage(`✨ 已添加 ${request.fromUsername} 为好友`);
    }
  } catch (error) {
    console.error('接受好友请求失败:', error);
  }
}

// 拒绝好友请求（从通讯录列表）
async function rejectRequest(index) {
  const request = friendRequests[index];
  
  try {
    const response = await fetch('/api/friend-request/response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: request.from,
        to: currentUser.username,
        accept: false
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // 从请求列表中移除
      friendRequests.splice(index, 1);
      updateRequestBadge();
      renderFriendRequests();
      // 显示通知
      showChatMessage(`已拒绝 ${request.fromUsername} 的好友请求`);
    }
  } catch (error) {
    console.error('拒绝好友请求失败:', error);
  }
}

// 修改用户名
function editUsername() {
  const displayDiv = document.getElementById('username-display');
  const editorDiv = document.getElementById('username-editor');
  const input = document.getElementById('username-input');
  
  // 隐藏显示，显示编辑框
  displayDiv.style.display = 'none';
  editorDiv.style.display = 'block';
  
  // 设置当前值并聚焦
  input.value = currentUser.username;
  input.focus();
  input.select();
}

// 保存用户名
function saveUsername() {
  const input = document.getElementById('username-input');
  const newUsername = input.value.trim();
  
  if (!newUsername) {
    showChatMessage('❌ 昵称不能为空');
    input.focus();
    return;
  }
  
  if (newUsername === currentUser.username) {
    showChatMessage('❌ 昵称没有变化');
    cancelEdit();
    return;
  }
  
  // 更新用户名
  updateUsername(newUsername);
}

// 取消编辑
function cancelEdit() {
  const displayDiv = document.getElementById('username-display');
  const editorDiv = document.getElementById('username-editor');
  
  editorDiv.style.display = 'none';
  displayDiv.style.display = 'flex';
}

// 编辑框回车键处理
function handleEditKeyPress(event) {
  if (event.key === 'Enter') {
    saveUsername();
  } else if (event.key === 'Escape') {
    cancelEdit();
  }
}

// 显示设置面板
function showSettings() {
  document.getElementById('settings-panel').style.display = 'block';
}

// 关闭设置面板
function closeSettings() {
  document.getElementById('settings-panel').style.display = 'none';
}

// 保存微信号
function saveWechatId() {
  const input = document.getElementById('my-wechat-id');
  const newWechatId = input.value.trim();
  
  if (!newWechatId) {
    showChatMessage('❌ 微信号不能为空');
    return;
  }
  
  if (newWechatId === currentUser.wechatId) {
    showChatMessage('❌ 微信号没有变化');
    return;
  }
  
  // 验证微信号格式
  const wechatRegex = /^[a-zA-Z][a-zA-Z0-9_-]{7,}$/;
  if (!wechatRegex.test(newWechatId)) {
    showChatMessage('❌ 微信号必须以字母开头，8 位以上，可包含字母、数字、下划线和短横线');
    return;
  }
  
  updateWechatId(newWechatId);
}

// 更新微信号到服务器
async function updateWechatId(newWechatId) {
  try {
    const response = await fetch('/api/update-wechat-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        newWechatId: newWechatId
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // 更新本地用户信息
      currentUser.wechatId = newWechatId;
      
      // 更新所有显示微信号的地方
      updateAllWechatIdDisplays(newWechatId);
      
      showChatMessage('✓ 微信号已修改为：' + newWechatId);
    } else {
      showChatMessage('❌ ' + data.message);
    }
  } catch (error) {
    console.error('更新微信号失败:', error);
    showChatMessage('❌ 修改微信号失败，请重试');
  }
}

// 更新所有显示微信号的地方
function updateAllWechatIdDisplays(newWechatId) {
  // 更新设置面板中的微信号
  document.getElementById('my-wechat-id').value = newWechatId;
  
  // 更新个人信息区域的微信号
  const wechatIdEl = document.getElementById('current-wechat-id');
  if (wechatIdEl) {
    wechatIdEl.textContent = `微信号：${newWechatId}`;
  }
  
  // 更新通讯录中的微信号
  renderContactsList();
  
  // 更新修改时间提示
  checkWechatModifyTime();
}

// 检查微信号修改时间
function checkWechatModifyTime() {
  const modifyInfo = document.getElementById('wechat-modify-info');
  const nextModifyTimeEl = document.getElementById('next-modify-time');
  const tipEl = document.getElementById('wechat-modify-tip');
  
  // 从服务器获取最新用户信息
  fetch(`/api/user/${currentUser.username}`)
    .then(res => res.json())
    .then(data => {
      if (data.success && data.user) {
        const modifyTime = data.user.wechatIdModifyTime;
        
        if (modifyTime) {
          const lastModify = new Date(modifyTime);
          const nextModify = new Date(lastModify.getTime() + 365 * 24 * 60 * 60 * 1000);
          const now = new Date();
          
          if (now < nextModify) {
            // 还在锁定期
            const daysLeft = Math.ceil((nextModify - now) / (24 * 60 * 60 * 1000));
            nextModifyTimeEl.textContent = `下次修改时间：${formatDaysLeft(daysLeft)}`;
            modifyInfo.style.display = 'flex';
            tipEl.textContent = '微信号已修改，每年只能修改一次';
            
            // 禁用输入框和按钮
            document.getElementById('my-wechat-id').disabled = true;
            document.querySelector('.save-wechat-btn').disabled = true;
            document.querySelector('.save-wechat-btn').style.background = '#ccc';
            document.querySelector('.save-wechat-btn').style.cursor = 'not-allowed';
          } else {
            // 可以修改
            modifyInfo.style.display = 'none';
            tipEl.textContent = '微信号必须以字母开头，8 位以上';
            
            // 启用输入框和按钮
            document.getElementById('my-wechat-id').disabled = false;
            document.querySelector('.save-wechat-btn').disabled = false;
            document.querySelector('.save-wechat-btn').style.background = '#07c160';
            document.querySelector('.save-wechat-btn').style.cursor = 'pointer';
          }
        } else {
          // 从未修改过
          modifyInfo.style.display = 'none';
          tipEl.textContent = '微信号必须以字母开头，8 位以上';
          
          // 启用输入框和按钮
          document.getElementById('my-wechat-id').disabled = false;
          document.querySelector('.save-wechat-btn').disabled = false;
          document.querySelector('.save-wechat-btn').style.background = '#07c160';
          document.querySelector('.save-wechat-btn').style.cursor = 'pointer';
        }
      }
    })
    .catch(err => {
      console.error('获取用户信息失败:', err);
    });
}

// 格式化剩余天数
function formatDaysLeft(days) {
  if (days <= 0) {
    return '今天';
  } else if (days === 1) {
    return '明天';
  } else if (days < 30) {
    return `${days}天后`;
  } else if (days < 365) {
    const months = Math.floor(days / 30);
    return `约${months}个月后`;
  } else {
    const years = Math.floor(days / 365);
    return `约${years}年后`;
  }
}

// 显示聊天更多信息面板
function showChatMore() {
  if (!currentChat) return;
  
  const panel = document.getElementById('chat-more-panel');
  const remarkInput = document.getElementById('friend-remark-input');
  
  // 加载当前好友的备注
  remarkInput.value = friendRemarks[currentChat] || '';
  
  panel.style.display = 'block';
}

// 关闭聊天更多信息面板
function closeChatMore() {
  document.getElementById('chat-more-panel').style.display = 'none';
}

// 保存好友备注
async function saveFriendRemark() {
  if (!currentChat) return;
  
  const remarkInput = document.getElementById('friend-remark-input');
  const remark = remarkInput.value.trim();
  
  try {
    const response = await fetch('/api/friend-remark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        friendUsername: currentChat,
        remark: remark
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // 更新本地备注
      if (remark) {
        friendRemarks[currentChat] = remark;
      } else {
        delete friendRemarks[currentChat];
      }
      
      // 更新界面显示
      updateChatHeader();
      updateFriendList();
      
      showChatMessage('✓ 备注已保存');
      closeChatMore();
    } else {
      showChatMessage('❌ ' + data.message);
    }
  } catch (error) {
    console.error('保存备注失败:', error);
    showChatMessage('❌ 保存备注失败');
  }
}

// 加载好友备注
async function loadFriendRemarks() {
  try {
    const response = await fetch(`/api/friend-remarks/${currentUser.username}`);
    const data = await response.json();
    
    if (data.success && data.remarks) {
      friendRemarks = data.remarks;
    }
  } catch (error) {
    console.error('加载备注失败:', error);
  }
}

// 获取显示名称（优先显示备注）
function getDisplayName(username) {
  return friendRemarks[username] || username;
}

// 更新聊天头部显示
function updateChatHeader() {
  if (!currentChat) return;
  
  const displayName = getDisplayName(currentChat);
  document.getElementById('chat-with-name').textContent = displayName;
  
  // 显示备注提示
  const remarkEl = document.getElementById('chat-with-remark');
  if (friendRemarks[currentChat]) {
    remarkEl.textContent = `备注：${friendRemarks[currentChat]}`;
    remarkEl.style.display = 'block';
  } else {
    remarkEl.style.display = 'none';
  }
}

// 更新好友列表显示
function updateFriendList() {
  // 刷新聊天列表
  loadFriends();
  // 刷新通讯录
  renderContactsList();
}

// 更新用户名到服务器
async function updateUsername(newUsername) {
  try {
    const response = await fetch('/api/update-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oldUsername: currentUser.username,
        newUsername: newUsername
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // 更新本地用户信息
      currentUser.username = newUsername;
      
      // 更新界面显示
      document.getElementById('current-username').textContent = newUsername;
      document.getElementById('current-user-avatar').textContent = newUsername[0].toUpperCase();
      
      // 显示成功提示
      showChatMessage(`✓ 昵称已修改为：${newUsername}`);
      
      // 刷新好友列表和通讯录
      loadFriends();
      renderContactsList();
    } else {
      showChatMessage(`❌ ${data.message}`);
    }
  } catch (error) {
    console.error('更新用户名失败:', error);
    showChatMessage('❌ 修改昵称失败，请重试');
  }
}

// 复制微信号
function copyWechatId(element) {
  const wechatId = element.textContent.replace('微信号：', '').trim();
  
  // 使用 Clipboard API
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(wechatId).then(() => {
      showCopySuccess(element);
    }).catch(err => {
      console.error('复制失败:', err);
      fallbackCopy(wechatId, element);
    });
  } else {
    // 降级方案
    fallbackCopy(wechatId, element);
  }
}

// 降级复制方案
function fallbackCopy(text, element) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.top = '0';
  textArea.style.left = '0';
  textArea.style.width = '2em';
  textArea.style.height = '2em';
  textArea.style.padding = '0';
  textArea.style.border = 'none';
  textArea.style.outline = 'none';
  textArea.style.boxShadow = 'none';
  textArea.style.background = 'transparent';
  textArea.style.opacity = '0';
  
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    document.execCommand('copy');
    showCopySuccess(element);
  } catch (err) {
    console.error('复制失败:', err);
  }
  
  document.body.removeChild(textArea);
}

// 显示复制成功提示
function showCopySuccess(element) {
  const originalText = element.textContent;
  const isResult = element.classList.contains('result-wechat-id');
  
  // 显示复制成功
  element.textContent = '✓ 已复制';
  element.style.background = '#07c160';
  element.style.color = 'white';
  
  // 1.5 秒后恢复
  setTimeout(() => {
    element.textContent = isResult ? `微信号：${originalText.replace('微信号：', '')}` : originalText;
    element.style.background = '';
    element.style.color = '';
  }, 1500);
  
  // 显示顶部通知
  showChatMessage('✓ 微信号已复制到剪贴板');
}

// 检查登录状态
async function checkLoginStatus() {
  const token = localStorage.getItem('token');
  if (!token) {
    showLogin();
    return;
  }
  
  try {
    const response = await fetch('/api/me', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        currentUser = data.user;
        showChatInterface();
        return;
      }
    }
    
    // Token 无效或过期，清除本地存储
    localStorage.removeItem('token');
    showLogin();
  } catch (error) {
    console.error('检查登录状态失败:', error);
    showLogin();
  }
}

// 头像上传处理
async function handleAvatarUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  // 预览
  const reader = new FileReader();
  reader.onload = (e) => {
    const currentUserAvatar = document.getElementById('current-user-avatar');
    const settingsAvatarPreview = document.getElementById('settings-avatar-preview');
    currentUserAvatar.innerHTML = `<img src="${e.target.result}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
    settingsAvatarPreview.innerHTML = `<img src="${e.target.result}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
  };
  reader.readAsDataURL(file);
  
  // 上传
  const formData = new FormData();
  formData.append('avatar', file);
  
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/avatar', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });
    
    const data = await response.json();
    
    if (data.success) {
      currentUser.avatar = data.avatarUrl;
      showChatMessage('✓ 头像修改成功');
      
      // 更新头像显示（添加时间戳防止缓存）
      const timestamp = Date.now();
      const currentUserAvatar = document.getElementById('current-user-avatar');
      const settingsAvatarPreview = document.getElementById('settings-avatar-preview');
      const avatarUrl = `${data.avatarUrl}?t=${timestamp}`;
      
      currentUserAvatar.innerHTML = `<img src="${avatarUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
      settingsAvatarPreview.innerHTML = `<img src="${avatarUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
    } else {
      showChatMessage('❌ ' + (data.error || '上传失败'));
      location.reload();
    }
  } catch (error) {
    console.error('头像上传失败:', error);
    showChatMessage('❌ 网络错误');
    location.reload();
  }
}

// 表情包列表
const emojis = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
  '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩',
  '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝',
  '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐',
  '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌',
  '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢',
  '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠',
  '🥳', '😎', '🤓', '🧐', '👍', '👎', '👏', '🙌'
];

// 初始化表情包面板
function initEmojiPanel() {
  const emojiGrid = document.getElementById('emoji-grid');
  emojiGrid.innerHTML = '';
  
  emojis.forEach(emoji => {
    const emojiItem = document.createElement('div');
    emojiItem.className = 'emoji-item';
    emojiItem.textContent = emoji;
    emojiItem.onclick = () => insertEmoji(emoji);
    emojiGrid.appendChild(emojiItem);
  });
}

// 切换表情包面板
function toggleEmojiPanel() {
  const emojiPanel = document.getElementById('emoji-panel');
  if (emojiPanel.style.display === 'none' || emojiPanel.style.display === '') {
    emojiPanel.style.display = 'block';
    initEmojiPanel();
  } else {
    emojiPanel.style.display = 'none';
  }
}

// 插入表情到输入框
function insertEmoji(emoji) {
  const input = document.getElementById('message-content');
  
  // 获取光标位置
  const start = input.selectionStart;
  const end = input.selectionEnd;
  
  // 在光标位置插入表情
  input.value = input.value.substring(0, start) + emoji + input.value.substring(end);
  
  // 重新设置光标位置
  input.selectionStart = input.selectionEnd = start + emoji.length;
  
  // 聚焦输入框
  input.focus();
  
  // 可以选择是否关闭表情面板，这里让它保持打开方便连续选择
  // document.getElementById('emoji-panel').style.display = 'none';
}

// 发送表情包（保留这个函数，方便以后使用）
function sendEmoji(emoji) {
  if (!currentChat) {
    showChatMessage('请先选择一个好友');
    return;
  }
  
  const message = {
    from: currentUser.username,
    to: currentChat,
    content: emoji,
    type: 'emoji',
    timestamp: new Date().toISOString()
  };
  
  socket.emit('send-message', message);
  
  // 关闭表情包面板
  document.getElementById('emoji-panel').style.display = 'none';
}

// 点击页面其他地方关闭表情包面板
document.addEventListener('click', (e) => {
  const emojiPanel = document.getElementById('emoji-panel');
  const emojiBtn = document.querySelector('.emoji-btn');
  
  if (emojiPanel && emojiPanel.style.display === 'block' && 
      !emojiPanel.contains(e.target) && 
      !emojiBtn.contains(e.target)) {
    emojiPanel.style.display = 'none';
  }
});

// 群聊相关全局变量
let selectedGroupFriends = [];
let currentGroup = null;
let groupsMap = new Map(); // 全局群聊数据缓存

// 显示创建群聊面板
function showCreateGroupPanel() {
  selectedGroupFriends = [];
  document.getElementById('group-name-input').value = '';
  document.getElementById('create-group-panel').style.display = 'block';
  loadFriendsForGroupSelection();
}

// 关闭创建群聊面板
function closeCreateGroupPanel() {
  document.getElementById('create-group-panel').style.display = 'none';
  selectedGroupFriends = [];
}

// 加载好友供选择
async function loadFriendsForGroupSelection() {
  try {
    const response = await fetch(`/api/friends/${currentUser.username}`);
    const data = await response.json();
    const container = document.getElementById('group-friends-list');
    container.innerHTML = '';
    
    if (data.friends && data.friends.length > 0) {
      data.friends.forEach(friend => {
        const friendItem = document.createElement('div');
        friendItem.className = 'group-friend-item';
        friendItem.dataset.username = friend.username;
        
        let avatarContent = friend.username[0].toUpperCase();
        if (friend.avatar) {
          avatarContent = `<img src="${friend.avatar}?t=${Date.now()}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
        }
        
        friendItem.innerHTML = `
          <div class="avatar">${avatarContent}</div>
          <span class="friend-name">${friend.username}</span>
          <div class="checkmark">✓</div>
        `;
        
        friendItem.onclick = () => toggleFriendSelection(friend.username, friendItem);
        container.appendChild(friendItem);
      });
    } else {
      container.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">暂无好友</div>';
    }
  } catch (error) {
    console.error('加载好友失败:', error);
  }
}

// 切换好友选择状态
function toggleFriendSelection(username, element) {
  const index = selectedGroupFriends.indexOf(username);
  if (index > -1) {
    selectedGroupFriends.splice(index, 1);
    element.classList.remove('selected');
  } else {
    selectedGroupFriends.push(username);
    element.classList.add('selected');
  }
}

// 创建群聊
async function createGroup() {
  const groupName = document.getElementById('group-name-input').value.trim();
  
  if (!groupName) {
    showChatMessage('请输入群聊名称');
    return;
  }
  
  if (selectedGroupFriends.length === 0) {
    showChatMessage('请至少选择一个好友');
    return;
  }
  
  try {
    const response = await fetch('/api/group/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: groupName,
        creator: currentUser.username,
        members: selectedGroupFriends
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showChatMessage('✓ 群聊创建成功！');
      closeCreateGroupPanel();
      loadGroups();
      showTab('groups');
    } else {
      showChatMessage('❌ ' + data.message);
    }
  } catch (error) {
    console.error('创建群聊失败:', error);
    showChatMessage('❌ 创建群聊失败');
  }
}

// 加载群聊列表
async function loadGroups() {
  try {
    const response = await fetch(`/api/groups/${currentUser.username}`);
    const data = await response.json();
    const groupsList = document.getElementById('groups-list');
    groupsList.innerHTML = '';
    
    // 清空并重新填充群聊缓存
    groupsMap.clear();
    
    if (data.groups && data.groups.length > 0) {
      data.groups.forEach(group => {
        groupsMap.set(group.id, group);
        addGroupToList(group);
      });
    } else {
      groupsList.innerHTML = '<li style="text-align: center; color: #999; padding: 40px;">暂无群聊，点击上方按钮创建</li>';
    }
  } catch (error) {
    console.error('加载群聊列表失败:', error);
  }
}

// 添加群聊到列表
function addGroupToList(group) {
  const groupsList = document.getElementById('groups-list');
  const li = document.createElement('li');
  li.dataset.groupId = group.id;
  
  let avatarContent = group.name[0].toUpperCase();
  if (group.avatar) {
    avatarContent = `<img src="${group.avatar}?t=${Date.now()}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 5px;">`;
  }
  
  li.innerHTML = `
    <div class="group-avatar">${avatarContent}</div>
    <div class="group-info">
      <span class="group-name">${group.name}</span>
      <span class="group-member-count">${group.memberCount} 人</span>
    </div>
  `;
  
  li.onclick = () => selectGroup(group);
  groupsList.appendChild(li);
}

// 选择群聊
function selectGroup(group) {
  currentGroup = group;
  currentChat = null;
  
  // 移除之前的选中状态
  document.querySelectorAll('#groups-list li').forEach(li => {
    li.classList.remove('active');
  });
  
  // 添加新的选中状态
  const selectedLi = document.querySelector(`#groups-list li[data-group-id="${group.id}"]`);
  if (selectedLi) {
    selectedLi.classList.add('active');
  }
  
  // 隐藏单聊和无聊天提示
  document.getElementById('no-chat').style.display = 'none';
  document.getElementById('chat-box').style.display = 'none';
  
  // 显示群聊聊天界面
  document.getElementById('group-chat-box').style.display = 'flex';
  
  // 更新群聊头部信息
  const groupChatAvatar = document.getElementById('group-chat-avatar');
  if (group.avatar) {
    groupChatAvatar.innerHTML = `<img src="${group.avatar}?t=${Date.now()}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 5px;">`;
  } else {
    groupChatAvatar.textContent = group.name[0].toUpperCase();
  }
  document.getElementById('group-chat-name').textContent = group.name;
  document.getElementById('group-member-count').textContent = `${group.memberCount} 人`;
  
  // 加载群聊历史消息
  loadGroupMessages(group.id);
  
  // 渲染群成员列表
  renderGroupMembers(group.members);
}

// 渲染群成员列表
function renderGroupMembers(members) {
  const container = document.getElementById('group-members-display');
  container.innerHTML = '';
  
  members.forEach(member => {
    const memberItem = document.createElement('div');
    memberItem.className = 'group-member-item';
    
    let avatarContent = member.username[0].toUpperCase();
    if (member.avatar) {
      avatarContent = `<img src="${member.avatar}?t=${Date.now()}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
    }
    
    memberItem.innerHTML = `
      <div class="avatar">${avatarContent}</div>
      <span class="member-name">${member.username}</span>
      <span class="member-status ${member.online ? 'online' : ''}"></span>
    `;
    
    container.appendChild(memberItem);
  });
}

// 加载群聊历史消息
function loadGroupMessages(groupId) {
  const messagesEl = document.getElementById('group-messages');
  messagesEl.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">加载中...</div>';
  
  socket.emit('get-group-messages', { groupId }, (messages) => {
    messagesEl.innerHTML = '';
    
    if (!messages || messages.length === 0) {
      messagesEl.innerHTML = '<div style="text-align: center; color: #ccc; padding: 40px;">暂无消息，打个招呼吧~</div>';
      return;
    }
    
    messages.forEach(message => {
      addGroupMessageToUI(message);
    });
    
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

// 添加群聊消息到 UI
function addGroupMessageToUI(message) {
  const messagesEl = document.getElementById('group-messages');
  
  const loadingDiv = messagesEl.querySelector('div[style*="text-align: center"]');
  if (loadingDiv) {
    loadingDiv.remove();
  }
  
  const isSent = message.from === currentUser.username;
  
  const messageDiv = document.createElement('div');
  messageDiv.className = 'group-message-item';
  messageDiv.style.animation = 'message-fade-in 0.3s ease-out';
  
  let avatarContent = message.from[0].toUpperCase();
  if (isSent && currentUser.avatar) {
    avatarContent = `<img src="${currentUser.avatar}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`;
  } else {
    const groupMember = currentGroup?.members?.find(m => m.username === message.from);
    if (groupMember && groupMember.avatar) {
      avatarContent = `<img src="${groupMember.avatar}?t=${Date.now()}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`;
    }
  }
  
  const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  
  let messageContent = '';
  if (message.type === 'image') {
    messageContent = `<img src="${escapeHtml(message.content)}" alt="图片" onclick="viewImage(this.src)" style="cursor: pointer;">`;
  } else if (message.type === 'video') {
    messageContent = `<div style="position: relative; cursor: pointer;" onclick="viewVideo('${escapeHtml(message.content)}')">
      <video src="${escapeHtml(message.content)}" style="pointer-events: none; max-width: 300px;"></video>
      <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 60px; height: 60px; background: rgba(0,0,0,0.6); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
        <div style="width: 0; height: 0; border-left: 20px solid white; border-top: 12px solid transparent; border-bottom: 12px solid transparent; margin-left: 5px;"></div>
      </div>
    </div>`;
  } else if (message.type === 'emoji') {
    const parsedEmoji = twemoji.parse(message.content, {
      base: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/',
      folder: 'svg',
      ext: '.svg',
      attributes: () => ({
        class: 'emoji',
        style: 'width: 32px; height: 32px; vertical-align: middle; display: inline-block;'
      })
    });
    messageContent = `<span style="display: inline-block; line-height: 1.2;">${parsedEmoji}</span>`;
  } else {
    const textContent = escapeHtml(message.content);
    const tempDiv = document.createElement('div');
    tempDiv.textContent = textContent;
    const parsedText = twemoji.parse(tempDiv.innerHTML, {
      base: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/',
      folder: 'svg',
      ext: '.svg',
      attributes: () => ({
        class: 'emoji small',
        style: 'width: 20px; height: 20px; vertical-align: middle; margin: 0 2px; display: inline-block;'
      })
    });
    messageContent = parsedText;
  }
  
  // 群聊所有消息布局统一：头像在左边，聊天气泡在右边
  const senderName = message.from;
  const bubbleBgClass = isSent ? 'group-message-bubble-sent' : 'group-message-bubble-received';
  
  messageDiv.innerHTML = `
    <div class="group-message-avatar-wrapper">
      <div class="group-message-avatar">${avatarContent}</div>
      <div class="group-message-time">${time}</div>
    </div>
    <div class="group-message-content-wrapper">
      <div class="group-message-sender">${escapeHtml(senderName)}</div>
      <div class="group-message-bubble ${bubbleBgClass}">${messageContent}</div>
    </div>
  `;
  
  messagesEl.appendChild(messageDiv);
  messagesEl.scrollTo({
    top: messagesEl.scrollHeight,
    behavior: 'smooth'
  });
}

// 发送群聊消息
async function sendGroupMessage() {
  const input = document.getElementById('group-message-content');
  const content = input.value.trim();
  
  if (!content && !window.groupSelectedFile) return;
  
  if (window.groupSelectedFile) {
    await sendGroupFileMessage(window.groupSelectedFile);
    window.groupSelectedFile = null;
    document.getElementById('group-file-input').value = '';
  } else {
    const messageType = isPureEmoji(content) ? 'emoji' : 'text';
    
    const message = {
      groupId: currentGroup.id,
      from: currentUser.username,
      content: content,
      type: messageType,
      timestamp: new Date().toISOString()
    };
    
    socket.emit('send-group-message', message);
  }
  
  input.value = '';
  input.focus();
}

// 处理群聊文件选择
function handleGroupFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  
  if (!isImage && !isVideo) {
    showChatMessage('❌ 只能发送图片或视频文件');
    return;
  }
  
  const maxSize = 2 * 1024 * 1024 * 1024;
  if (file.size > maxSize) {
    showChatMessage('❌ 文件大小不能超过 2GB');
    return;
  }
  
  window.groupSelectedFile = file;
  showGroupFilePreview(file);
}

// 显示群聊文件预览并发送
async function showGroupFilePreview(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();
    
    if (data.success) {
      const isImage = data.mimeType.startsWith('image/');
      const fileType = isImage ? 'image' : 'video';
      
      const message = {
        groupId: currentGroup.id,
        from: currentUser.username,
        content: data.url,
        type: fileType,
        fileName: data.fileName,
        fileSize: data.fileSize,
        timestamp: new Date().toISOString()
      };
      
      socket.emit('send-group-message', message);
      
      showChatMessage(`✓ ${isImage ? '图片' : '视频'} 已发送`);
    } else {
      showChatMessage('❌ ' + (data.error || '上传失败'));
    }
  } catch (error) {
    console.error('上传失败:', error);
    showChatMessage('❌ 上传失败，请重试');
  }
}

// 发送群聊文件消息
async function sendGroupFileMessage(file) {
  await showGroupFilePreview(file);
}

// 群聊回车发送消息
function handleGroupKeyPress(event) {
  if (event.key === 'Enter') {
    sendGroupMessage();
  }
}

// 切换群聊表情包面板
function toggleGroupEmojiPanel() {
  const emojiPanel = document.getElementById('group-emoji-panel');
  if (emojiPanel.style.display === 'none' || emojiPanel.style.display === '') {
    emojiPanel.style.display = 'block';
    initGroupEmojiPanel();
  } else {
    emojiPanel.style.display = 'none';
  }
}

// 初始化群聊表情包面板
function initGroupEmojiPanel() {
  const emojiGrid = document.getElementById('group-emoji-grid');
  emojiGrid.innerHTML = '';
  
  emojis.forEach(emoji => {
    const emojiItem = document.createElement('div');
    emojiItem.className = 'emoji-item';
    emojiItem.textContent = emoji;
    emojiItem.onclick = () => insertGroupEmoji(emoji);
    emojiGrid.appendChild(emojiItem);
  });
}

// 插入表情到群聊输入框
function insertGroupEmoji(emoji) {
  const input = document.getElementById('group-message-content');
  
  const start = input.selectionStart;
  const end = input.selectionEnd;
  
  input.value = input.value.substring(0, start) + emoji + input.value.substring(end);
  input.selectionStart = input.selectionEnd = start + emoji.length;
  input.focus();
}

// 显示群聊更多面板
function showGroupChatMore() {
  if (!currentGroup) return;
  // 填充当前群聊名称
  document.getElementById('group-name-edit').value = currentGroup.name;
  // 显示当前群头像
  const groupAvatarPreview = document.getElementById('group-avatar-preview');
  if (currentGroup.avatar) {
    groupAvatarPreview.innerHTML = `<img src="${currentGroup.avatar}?t=${Date.now()}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
  } else {
    groupAvatarPreview.textContent = currentGroup.name[0].toUpperCase();
  }
  document.getElementById('group-chat-more-panel').style.display = 'block';
}

// 关闭群聊更多面板
function closeGroupChatMore() {
  document.getElementById('group-chat-more-panel').style.display = 'none';
}

// 保存群聊名称
async function saveGroupName() {
  const newName = document.getElementById('group-name-edit').value.trim();
  
  if (!newName) {
    showChatMessage('❌ 群聊名称不能为空');
    return;
  }
  
  if (!currentGroup) {
    showChatMessage('❌ 请先选择一个群聊');
    return;
  }
  
  try {
    const response = await fetch('/api/group/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: currentGroup.id,
        operator: currentUser.username,
        newName: newName
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showChatMessage('✓ 群聊名称已修改');
      // 更新当前群聊信息
      currentGroup.name = newName;
      // 更新聊天头部显示
      document.getElementById('group-chat-name').textContent = newName;
      // 刷新群聊列表
      loadGroups();
      closeGroupChatMore();
    } else {
      showChatMessage('❌ ' + data.message);
    }
  } catch (error) {
    console.error('修改群聊名称失败:', error);
    showChatMessage('❌ 修改群聊名称失败');
  }
}

// 处理群头像上传
async function handleGroupAvatarUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!currentGroup) {
    showChatMessage('❌ 请先选择一个群聊');
    return;
  }

  // 预览
  const reader = new FileReader();
  reader.onload = (e) => {
    const groupAvatarPreview = document.getElementById('group-avatar-preview');
    groupAvatarPreview.innerHTML = `<img src="${e.target.result}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
  };
  reader.readAsDataURL(file);

  // 上传
  const formData = new FormData();
  formData.append('avatar', file);
  formData.append('groupId', currentGroup.id);

  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/group/avatar', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    const data = await response.json();

    if (data.success) {
      showChatMessage('✓ 群头像修改成功');
    } else {
      showChatMessage('❌ ' + (data.error || '上传失败'));
    }
  } catch (error) {
    console.error('群头像上传失败:', error);
    showChatMessage('❌ 网络错误');
  }
}

// 拉好友进群相关
let selectedAddMembers = [];

// 显示拉好友进群面板
function showAddMembersPanel() {
  selectedAddMembers = [];
  closeGroupChatMore();
  document.getElementById('add-members-panel').style.display = 'block';
  loadFriendsForAddMembers();
}

// 关闭拉好友进群面板
function closeAddMembersPanel() {
  document.getElementById('add-members-panel').style.display = 'none';
  selectedAddMembers = [];
}

// 加载好友供拉进群
async function loadFriendsForAddMembers() {
  try {
    const response = await fetch(`/api/friends/${currentUser.username}`);
    const data = await response.json();
    const container = document.getElementById('add-members-friends-list');
    container.innerHTML = '';
    
    if (data.friends && data.friends.length > 0) {
      data.friends.forEach(friend => {
        const isAlreadyInGroup = currentGroup?.members?.some(m => m.username === friend.username);
        
        const friendItem = document.createElement('div');
        friendItem.className = `group-friend-item ${isAlreadyInGroup ? 'disabled' : ''}`;
        friendItem.dataset.username = friend.username;
        
        let avatarContent = friend.username[0].toUpperCase();
        if (friend.avatar) {
          avatarContent = `<img src="${friend.avatar}?t=${Date.now()}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
        }
        
        friendItem.innerHTML = `
          <div class="avatar">${avatarContent}</div>
          <span class="friend-name">${friend.username} ${isAlreadyInGroup ? '(已在群内)' : ''}</span>
          <div class="checkmark">✓</div>
        `;
        
        if (!isAlreadyInGroup) {
          friendItem.onclick = () => toggleAddMemberSelection(friend.username, friendItem);
        }
        
        container.appendChild(friendItem);
      });
    } else {
      container.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">暂无好友</div>';
    }
  } catch (error) {
    console.error('加载好友失败:', error);
  }
}

// 切换要添加的成员选择
function toggleAddMemberSelection(username, element) {
  const index = selectedAddMembers.indexOf(username);
  if (index > -1) {
    selectedAddMembers.splice(index, 1);
    element.classList.remove('selected');
  } else {
    selectedAddMembers.push(username);
    element.classList.add('selected');
  }
}

// 添加成员到群聊
async function addMembersToGroup() {
  if (selectedAddMembers.length === 0) {
    showChatMessage('请至少选择一个好友');
    return;
  }
  
  try {
    const response = await fetch('/api/group/add-members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: currentGroup.id,
        operator: currentUser.username,
        newMembers: selectedAddMembers
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showChatMessage(`✓ 已添加 ${data.addedMembers.length} 位成员到群聊`);
      closeAddMembersPanel();
      
      if (socket) {
        socket.disconnect();
        connectSocket();
      }
      
      loadGroups();
    } else {
      showChatMessage('❌ ' + data.message);
    }
  } catch (error) {
    console.error('添加成员失败:', error);
    showChatMessage('❌ 添加成员失败');
  }
}

// 初始化
checkLoginStatus();
