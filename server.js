const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// JWT 密钥
const JWT_SECRET = 'your-secret-key-change-in-production';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads')); // 静态文件访问

// JWT 验证中间件
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.sendStatus(401);
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403);
    }
    req.user = user;
    next();
  });
}

// 配置文件存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 根据文件类型分目录存储
    const isImage = file.mimetype.startsWith('image/');
    const uploadDir = isImage ? 'uploads/images' : 'uploads/videos';
    
    // 确保目录存在
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // 生成唯一文件名
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

// 文件过滤器 - 只允许图片和视频
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 
                      'video/mp4', 'video/webm', 'video/quicktime'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('不支持的文件类型'), false);
  }
};

// 创建上传中间件，设置最大限制为2GB
const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { 
    fileSize: 2 * 1024 * 1024 * 1024 // 最大2GB
  }
});

// 头像上传配置
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/avatars';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${req.user.userId}-${Date.now()}${ext}`;
    cb(null, filename);
  }
});

const avatarFileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('只支持 JPG/PNG/GIF 图片格式'), false);
  }
};

const avatarUpload = multer({
  storage: avatarStorage,
  fileFilter: avatarFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// 错误处理中间件
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: '文件大小超过限制' });
    }
  }
  res.status(400).json({ error: err.message });
});

// 内存数据库（实际生产环境应使用 MongoDB/MySQL）
const users = new Map(); // 用户数据
const messages = new Map(); // 聊天记录
const friendRequests = new Map(); // 好友请求
const onlineUsers = new Map(); // 在线用户 socketId 映射
const wechatIdMap = new Map(); // 微信号映射到用户名
const unreadCounts = new Map(); // 未读消息计数 {user: {friend: count}}
const groups = new Map(); // 群聊数据 {groupId: {id, name, members, owner, createdAt}}
const groupMessages = new Map(); // 群聊消息 {groupId: [messages]}
const userGroups = new Map(); // 用户的群聊 {username: [groupId]}

// 生成微信号（类似真实微信号格式）
function generateWechatId(username) {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `wx_${timestamp}${random}`;
}

// API: 用户注册
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: '用户名和密码不能为空' });
    }
    
    if (users.has(username)) {
      return res.status(400).json({ message: '用户名已存在' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    const wechatId = generateWechatId(username);
    
    users.set(username, {
      id: userId,
      username,
      password: hashedPassword,
      wechatId,
      friends: [],
      groups: [],
      createdAt: new Date(),
      avatar: null
    });
    
    // 初始化用户的群聊列表
    userGroups.set(username, []);
    
    wechatIdMap.set(wechatId, username);
    
    // 生成 JWT
    const token = jwt.sign(
      { userId: userId, username: username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({ 
      success: true, 
      message: '注册成功',
      user: { id: userId, username, wechatId, avatar: null },
      token: token
    });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// API: 用户登录
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: '用户名和密码不能为空' });
    }
    
    const user = users.get(username);
    if (!user) {
      return res.status(400).json({ message: '用户不存在' });
    }
    
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(400).json({ message: '密码错误' });
    }
    
    // 检查是否在冷却期
    if (user.loginCooldownUntil) {
      const cooldownTime = new Date(user.loginCooldownUntil);
      const now = new Date();
      
      if (now < cooldownTime) {
        const hoursLeft = Math.ceil((cooldownTime - now) / (1000 * 60 * 60));
        return res.status(400).json({ 
          message: `账号处于冷却期，请${hoursLeft}小时后再试`
        });
      }
    }
    
    // 更新登录时间
    user.lastLoginTime = new Date().toISOString();
    // 清除冷却时间
    delete user.loginCooldownUntil;
    
    // 生成 JWT
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({ 
      success: true, 
      message: '登录成功',
      user: { 
        id: user.id, 
        username: user.username, 
        wechatId: user.wechatId,
        lastLoginTime: user.lastLoginTime,
        avatar: user.avatar
      },
      token: token
    });
  } catch (error) {
    res.status(500).json({ message: '服务器错误' });
  }
});

// API: 验证 token 并获取用户信息
app.get('/api/me', authenticateToken, (req, res) => {
  const user = users.get(req.user.username);
  if (!user) {
    return res.sendStatus(404);
  }
  
  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      wechatId: user.wechatId,
      lastLoginTime: user.lastLoginTime,
      avatar: user.avatar
    }
  });
});

// API: 上传头像
app.post('/api/avatar', authenticateToken, avatarUpload.single('avatar'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请选择图片文件' });
    }

    const user = users.get(req.user.username);
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    // 删除旧头像文件
    if (user.avatar && !user.avatar.includes('default')) {
      const oldPath = path.join(__dirname, user.avatar);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    // 更新用户头像
    user.avatar = avatarUrl;

    // 通知所有好友头像已更新
    user.friends.forEach(friendUsername => {
      const friendSocketId = onlineUsers.get(friendUsername);
      if (friendSocketId) {
        io.to(friendSocketId).emit('avatar-updated', {
          username: req.user.username,
          avatar: avatarUrl
        });
      }
    });

    res.json({ success: true, avatarUrl });
  } catch (error) {
    console.error('头像上传失败:', error);
    res.status(500).json({ error: '上传失败，请重试' });
  }
});

// API: 上传文件（图片/视频）
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }
    
    // 手动检查文件大小限制
    const isImage = req.file.mimetype.startsWith('image/');
    const maxSize = 2 * 1024 * 1024 * 1024; // 最大2GB
    
    if (req.file.size > maxSize) {
      // 删除已上传的文件
      fs.unlinkSync(req.file.path);
      return res.status(413).json({ 
        error: '文件大小超过限制（最大2GB）' 
      });
    }
    
    // 构建可访问的URL
    const baseUrl = 'http://localhost:3000';
    const fileUrl = `${baseUrl}/${req.file.path.replace(/\\/g, '/')}`;
    
    res.json({
      success: true,
      url: fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 搜索用户（支持用户名或微信号搜索）
app.get('/api/search/:keyword', (req, res) => {
  const { keyword } = req.params;
  const searcher = req.query.searcher;
  
  if (!keyword) {
    return res.status(400).json({ message: '搜索关键词不能为空' });
  }
  
  let targetUsername = null;
  
  // 先尝试通过微信号搜索
  if (wechatIdMap.has(keyword)) {
    targetUsername = wechatIdMap.get(keyword);
  } 
  // 再尝试通过用户名搜索
  else if (users.has(keyword)) {
    targetUsername = keyword;
  }
  
  if (!targetUsername) {
    return res.status(404).json({ message: '用户不存在，请检查微信号或用户名' });
  }
  
  const targetUser = users.get(targetUsername);
  const currentUser = users.get(searcher);
  
  // 不能搜索自己
  if (targetUsername === searcher) {
    return res.status(400).json({ message: '不能搜索自己' });
  }
  
  res.json({
    success: true,
    user: {
      id: targetUser.id,
      username: targetUser.username,
      wechatId: targetUser.wechatId,
      isFriend: currentUser.friends.includes(targetUsername)
    }
  });
});

// API: 发送好友请求
app.post('/api/friend-request', (req, res) => {
  const { from, to } = req.body;
  
  if (!users.has(from) || !users.has(to)) {
    return res.status(400).json({ message: '用户不存在' });
  }
  
  const fromUser = users.get(from);
  const toUser = users.get(to);
  
  // 检查是否已经是好友
  if (fromUser.friends.includes(to)) {
    return res.status(400).json({ message: '已经是好友' });
  }
  
  // 检查是否已经发送过请求
  const requestId = `${from}-${to}`;
  if (friendRequests.has(requestId)) {
    return res.status(400).json({ message: '好友请求已发送，请等待对方处理' });
  }
  
  const request = {
    id: uuidv4(),
    from,
    to,
    status: 'pending',
    createdAt: new Date()
  };
  
  friendRequests.set(requestId, request);
  
  // 通知目标用户有新的好友请求
  const toSocketId = onlineUsers.get(to);
  if (toSocketId) {
    io.to(toSocketId).emit('friend-request', {
      from,
      fromUsername: fromUser.username
    });
  }
  
  res.json({ success: true, message: '好友请求已发送' });
});

// API: 处理好友请求
app.post('/api/friend-request/response', (req, res) => {
  const { from, to, accept } = req.body;
  
  const requestId = `${from}-${to}`;
  const request = friendRequests.get(requestId);
  
  if (!request) {
    return res.status(404).json({ message: '好友请求不存在' });
  }
  
  if (accept) {
    // 添加好友
    const fromUser = users.get(from);
    const toUser = users.get(to);
    
    fromUser.friends.push(to);
    toUser.friends.push(from);
    
    // 通知双方
    const fromSocketId = onlineUsers.get(from);
    const toSocketId = onlineUsers.get(to);
    
    if (fromSocketId) {
      io.to(fromSocketId).emit('friend-added', {
        friend: to,
        friendUsername: toUser.username,
        wechatId: toUser.wechatId
      });
    }
    
    if (toSocketId) {
      io.to(toSocketId).emit('friend-added', {
        friend: from,
        friendUsername: fromUser.username,
        wechatId: fromUser.wechatId
      });
    }
  } else {
    // 拒绝好友请求，通知发送方
    const fromSocketId = onlineUsers.get(from);
    if (fromSocketId) {
      io.to(fromSocketId).emit('friend-request-rejected', {
        by: to,
        byUsername: users.get(to).username
      });
    }
  }
  
  friendRequests.delete(requestId);
  
  res.json({ success: true, message: accept ? '已添加好友' : '已拒绝好友请求' });
});

// API: 获取好友列表
app.get('/api/friends/:username', (req, res) => {
  const { username } = req.params;
  
  if (!users.has(username)) {
    return res.status(404).json({ message: '用户不存在' });
  }
  
  // 获取该用户的未读计数
  const userUnread = unreadCounts.get(username) || {};
  
  const user = users.get(username);
  const friends = user.friends.map(friendUsername => {
    const friend = users.get(friendUsername);
    return {
      id: friend.id,
      username: friend.username,
      wechatId: friend.wechatId,
      avatar: friend.avatar,
      online: onlineUsers.has(friendUsername),
      unreadCount: userUnread[friendUsername] || 0
    };
  });
  
  res.json({ success: true, friends });
});

// API: 创建群聊
app.post('/api/group/create', (req, res) => {
  const { name, creator, members } = req.body;
  
  if (!name || !creator || !members || members.length === 0) {
    return res.status(400).json({ message: '参数不完整' });
  }
  
  // 验证所有成员都存在
  for (const member of members) {
    if (!users.has(member)) {
      return res.status(404).json({ message: `用户 ${member} 不存在` });
    }
  }
  
  // 创建群聊
  const groupId = uuidv4();
  const group = {
    id: groupId,
    name,
    creator,
    avatar: null,
    members: [...new Set([creator, ...members])], // 去重
    createdAt: new Date()
  };
  
  groups.set(groupId, group);
  groupMessages.set(groupId, []);
  
  // 更新每个成员的群聊列表
  group.members.forEach(member => {
    const user = users.get(member);
    if (user && !user.groups.includes(groupId)) {
      user.groups.push(groupId);
    }
    
    const userGroupList = userGroups.get(member) || [];
    if (!userGroupList.includes(groupId)) {
      userGroupList.push(groupId);
      userGroups.set(member, userGroupList);
    }
    
    // 通知群成员有新群聊
    const socketId = onlineUsers.get(member);
    if (socketId) {
      io.to(socketId).emit('group-created', group);
    }
  });
  
  res.json({ success: true, group });
});

// API: 获取用户的群聊列表
app.get('/api/groups/:username', (req, res) => {
  const { username } = req.params;
  
  if (!users.has(username)) {
    return res.status(404).json({ message: '用户不存在' });
  }
  
  const userGroupList = userGroups.get(username) || [];
  const groupList = userGroupList.map(groupId => {
    const group = groups.get(groupId);
    if (!group) return null;
    
    // 获取群成员详细信息
    const memberDetails = group.members.map(memberUsername => {
      const member = users.get(memberUsername);
      return {
        username: member.username,
        avatar: member.avatar,
        online: onlineUsers.has(memberUsername)
      };
    });
    
    return {
      id: group.id,
      name: group.name,
      creator: group.creator,
      avatar: group.avatar,
      members: memberDetails,
      memberCount: group.members.length,
      createdAt: group.createdAt
    };
  }).filter(Boolean);
  
  res.json({ success: true, groups: groupList });
});

// API: 拉好友进群
app.post('/api/group/add-members', (req, res) => {
  const { groupId, operator, newMembers } = req.body;
  
  if (!groupId || !operator || !newMembers || newMembers.length === 0) {
    return res.status(400).json({ message: '参数不完整' });
  }
  
  if (!groups.has(groupId)) {
    return res.status(404).json({ message: '群聊不存在' });
  }
  
  const group = groups.get(groupId);
  
  // 验证操作者是否在群内
  if (!group.members.includes(operator)) {
    return res.status(403).json({ message: '你不在该群内' });
  }
  
  // 添加新成员
  const addedMembers = [];
  for (const member of newMembers) {
    if (!users.has(member)) {
      continue; // 跳过不存在的用户
    }
    if (!group.members.includes(member)) {
      group.members.push(member);
      addedMembers.push(member);
      
      // 更新用户的群聊列表
      const user = users.get(member);
      if (user && !user.groups.includes(groupId)) {
        user.groups.push(groupId);
      }
      
      const userGroupList = userGroups.get(member) || [];
      if (!userGroupList.includes(groupId)) {
        userGroupList.push(groupId);
        userGroups.set(member, userGroupList);
      }
      
      // 通知新成员
      const socketId = onlineUsers.get(member);
      if (socketId) {
        io.to(socketId).emit('group-created', group);
      }
    }
  }
  
  // 通知群所有成员有人加入
  group.members.forEach(member => {
    const socketId = onlineUsers.get(member);
    if (socketId) {
      io.to(socketId).emit('group-members-added', {
        groupId,
        addedMembers,
        operator
      });
    }
  });
  
  res.json({ success: true, group, addedMembers });
});

// API: 修改群聊名称
app.post('/api/group/rename', (req, res) => {
  const { groupId, operator, newName } = req.body;

  if (!groupId || !operator || !newName) {
    return res.status(400).json({ message: '参数不完整' });
  }

  if (!groups.has(groupId)) {
    return res.status(404).json({ message: '群聊不存在' });
  }

  const group = groups.get(groupId);

  // 验证操作者是否在群内
  if (!group.members.includes(operator)) {
    return res.status(403).json({ message: '你不在该群内' });
  }

  // 更新群名
  group.name = newName;

  // 通知群所有成员群名已更新
  group.members.forEach(member => {
    const socketId = onlineUsers.get(member);
    if (socketId) {
      io.to(socketId).emit('group-renamed', {
        groupId,
        newName,
        operator
      });
    }
  });

  res.json({ success: true, group });
});

// API: 上传群头像
app.post('/api/group/avatar', authenticateToken, avatarUpload.single('avatar'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请选择图片文件' });
    }

    const { groupId } = req.body;
    
    if (!groupId) {
      return res.status(400).json({ error: '群聊ID不能为空' });
    }

    if (!groups.has(groupId)) {
      return res.status(404).json({ error: '群聊不存在' });
    }

    const group = groups.get(groupId);

    // 验证操作者是否在群内
    if (!group.members.includes(req.user.username)) {
      return res.status(403).json({ error: '你不在该群内' });
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    // 删除旧头像文件
    if (group.avatar && !group.avatar.includes('default')) {
      const oldPath = path.join(__dirname, group.avatar);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    // 更新群头像
    group.avatar = avatarUrl;

    // 通知群所有成员群头像已更新
    group.members.forEach(member => {
      const socketId = onlineUsers.get(member);
      if (socketId) {
        io.to(socketId).emit('group-avatar-updated', {
          groupId,
          avatarUrl
        });
      }
    });

    res.json({ success: true, avatarUrl });
  } catch (error) {
    console.error('群头像上传失败:', error);
    res.status(500).json({ error: '上传失败，请重试' });
  }
});

// API: 修改用户名
app.post('/api/update-username', (req, res) => {
  const { oldUsername, newUsername } = req.body;
  
  if (!oldUsername || !newUsername) {
    return res.status(400).json({ message: '用户名不能为空' });
  }
  
  // 检查旧用户名是否存在
  if (!users.has(oldUsername)) {
    return res.status(404).json({ message: '用户不存在' });
  }
  
  // 检查新用户名是否已被使用
  if (users.has(newUsername) && newUsername !== oldUsername) {
    return res.status(400).json({ message: '该昵称已被使用' });
  }
  
  // 获取用户数据
  const user = users.get(oldUsername);
  
  // 更新用户数据
  user.username = newUsername;
  users.delete(oldUsername);
  users.set(newUsername, user);
  
  // 更新微信号映射
  wechatIdMap.delete(user.wechatId);
  wechatIdMap.set(user.wechatId, newUsername);
  
  // 更新好友列表中的用户名
  user.friends.forEach(friendUsername => {
    const friend = users.get(friendUsername);
    if (friend) {
      // 从朋友的好友列表中移除旧用户名
      const index = friend.friends.indexOf(oldUsername);
      if (index > -1) {
        friend.friends.splice(index, 1);
      }
      // 添加新用户名
      if (!friend.friends.includes(newUsername)) {
        friend.friends.push(newUsername);
      }
    }
  });
  
  // 更新在线用户映射
  if (onlineUsers.has(oldUsername)) {
    const socketId = onlineUsers.get(oldUsername);
    onlineUsers.delete(oldUsername);
    onlineUsers.set(newUsername, socketId);
  }
  
  res.json({ 
    success: true, 
    message: '修改成功',
    user: {
      id: user.id,
      username: user.username,
      wechatId: user.wechatId
    }
  });
});

// API: 设置好友备注
app.post('/api/friend-remark', (req, res) => {
  const { username, friendUsername, remark } = req.body;
  
  if (!username || !friendUsername) {
    return res.status(400).json({ message: '参数错误' });
  }
  
  // 检查用户是否存在
  if (!users.has(username)) {
    return res.status(404).json({ message: '用户不存在' });
  }
  
  const user = users.get(username);
  
  // 检查是否是好友
  if (!user.friends.includes(friendUsername)) {
    return res.status(400).json({ message: '不是好友关系' });
  }
  
  // 初始化备注对象
  if (!user.friendRemarks) {
    user.friendRemarks = {};
  }
  
  // 设置或删除备注
  if (remark && remark.trim()) {
    user.friendRemarks[friendUsername] = remark.trim();
  } else {
    delete user.friendRemarks[friendUsername];
  }
  
  res.json({ 
    success: true, 
    message: '备注已保存',
    remark: user.friendRemarks[friendUsername] || null
  });
});

// API: 获取好友备注列表
app.get('/api/friend-remarks/:username', (req, res) => {
  const { username } = req.params;
  
  if (!users.has(username)) {
    return res.status(404).json({ message: '用户不存在' });
  }
  
  const user = users.get(username);
  
  res.json({ 
    success: true, 
    remarks: user.friendRemarks || {}
  });
});

// API: 获取用户信息
app.get('/api/user/:username', (req, res) => {
  const { username } = req.params;
  
  if (!users.has(username)) {
    return res.status(404).json({ message: '用户不存在' });
  }
  
  const user = users.get(username);
  
  res.json({ 
    success: true, 
    user: {
      id: user.id,
      username: user.username,
      wechatId: user.wechatId,
      wechatIdModifyTime: user.wechatIdModifyTime || null
    }
  });
});

// API: 修改微信号
app.post('/api/update-wechat-id', (req, res) => {
  const { username, newWechatId } = req.body;
  
  if (!username || !newWechatId) {
    return res.status(400).json({ message: '参数不能为空' });
  }
  
  // 验证微信号格式
  const wechatRegex = /^[a-zA-Z][a-zA-Z0-9_-]{7,}$/;
  if (!wechatRegex.test(newWechatId)) {
    return res.status(400).json({ message: '微信号必须以字母开头，8 位以上，可包含字母、数字、下划线和短横线' });
  }
  
  // 检查用户是否存在
  if (!users.has(username)) {
    return res.status(404).json({ message: '用户不存在' });
  }
  
  const user = users.get(username);
  
  // 检查是否已经修改过微信号
  if (user.wechatIdModifyTime) {
    const lastModifyTime = new Date(user.wechatIdModifyTime);
    const now = new Date();
    const oneYearLater = new Date(lastModifyTime.getTime() + 365 * 24 * 60 * 60 * 1000);
    
    if (now < oneYearLater) {
      // 计算剩余天数
      const daysLeft = Math.ceil((oneYearLater - now) / (24 * 60 * 60 * 1000));
      return res.status(400).json({ 
        message: `微信号每年只能修改一次，请${daysLeft}天后再试`
      });
    }
  }
  
  // 检查微信号是否已被使用
  if (wechatIdMap.has(newWechatId)) {
    const existingUser = wechatIdMap.get(newWechatId);
    if (existingUser !== username) {
      return res.status(400).json({ message: '该微信号已被使用' });
    }
  }
  
  const oldWechatId = user.wechatId;
  
  // 更新微信号
  user.wechatId = newWechatId;
  // 记录修改时间
  user.wechatIdModifyTime = new Date().toISOString();
  
  // 更新微信号映射
  wechatIdMap.delete(oldWechatId);
  wechatIdMap.set(newWechatId, username);
  
  res.json({ 
    success: true, 
    message: '微信号修改成功',
    wechatId: newWechatId,
    modifyTime: user.wechatIdModifyTime
  });
});

// Socket.IO 连接处理
io.on('connection', (socket) => {
  console.log('新用户连接:', socket.id);
  
  // 用户上线
  socket.on('user-online', ({ username }) => {
    onlineUsers.set(username, socket.id);
    socket.join(`user:${username}`);
    
    // 通知好友上线状态
    const user = users.get(username);
    if (user) {
      user.friends.forEach(friend => {
        const friendSocketId = onlineUsers.get(friend);
        if (friendSocketId) {
          io.to(friendSocketId).emit('user-status', {
            user: username,
            online: true
          });
        }
      });
    }
  });
  
  // 发送消息
  socket.on('send-message', (message) => {
    // 保存消息
    const chatId = [message.from, message.to].sort().join('-');
    if (!messages.has(chatId)) {
      messages.set(chatId, []);
    }
    messages.get(chatId).push(message);
    
    // 增加未读消息计数
    if (!unreadCounts.has(message.to)) {
      unreadCounts.set(message.to, {});
    }
    const userUnread = unreadCounts.get(message.to);
    userUnread[message.from] = (userUnread[message.from] || 0) + 1;
    
    // 发送给接收者，同时发送未读计数
    io.to(`user:${message.to}`).emit('receive-message', {
      ...message,
      unreadCount: userUnread[message.from]
    });
    
    // 发送确认给发送者
    socket.emit('message-sent', message);
  });
  
  // 获取聊天记录
  socket.on('get-messages', ({ user1, user2 }, callback) => {
    const chatId = [user1, user2].sort().join('-');
    const chatMessages = messages.get(chatId) || [];
    callback(chatMessages);
  });
  
  // 消息已读
  socket.on('mark-read', ({ from, to }) => {
    const chatId = [from, to].sort().join('-');
    const chatMessages = messages.get(chatId) || [];
    chatMessages.forEach(msg => {
      if (msg.to === to) {
        msg.read = true;
      }
    });
    
    // 清零未读计数
    if (unreadCounts.has(to)) {
      const userUnread = unreadCounts.get(to);
      userUnread[from] = 0;
    }
  });
  
  // 发送群聊消息
  socket.on('send-group-message', (message) => {
    const { groupId, from, content, type } = message;
    
    if (!groups.has(groupId)) {
      return;
    }
    
    const group = groups.get(groupId);
    
    // 验证发送者是否在群内
    if (!group.members.includes(from)) {
      return;
    }
    
    // 保存群聊消息
    const fullMessage = {
      ...message,
      timestamp: new Date().toISOString(),
      isGroup: true
    };
    
    if (!groupMessages.has(groupId)) {
      groupMessages.set(groupId, []);
    }
    groupMessages.get(groupId).push(fullMessage);
    
    // 广播给群内所有成员
    group.members.forEach(member => {
      const socketId = onlineUsers.get(member);
      if (socketId) {
        io.to(socketId).emit('receive-group-message', fullMessage);
      }
    });
  });
  
  // 获取群聊历史消息
  socket.on('get-group-messages', ({ groupId }, callback) => {
    const chatMessages = groupMessages.get(groupId) || [];
    callback(chatMessages);
  });
  
  // 用户下线
  socket.on('disconnect', () => {
    // 从在线列表中移除
    for (const [username, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        onlineUsers.delete(username);
        
        // 通知好友下线状态
        const user = users.get(username);
        if (user) {
          user.friends.forEach(friend => {
            const friendSocketId = onlineUsers.get(friend);
            if (friendSocketId) {
              io.to(friendSocketId).emit('user-status', {
                user: username,
                online: false
              });
            }
          });
        }
        break;
      }
    }
    
    console.log('用户断开连接:', socket.id);
  });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  
  // 启动账号状态检查任务（每小时检查一次）
  setInterval(checkAccountStatus, 60 * 60 * 1000);
  console.log('账号状态检查任务已启动');
});

// 检查账号状态
function checkAccountStatus() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneDayInMs = 24 * 60 * 60 * 1000;
  
  users.forEach((user, username) => {
    // 跳过已设置冷却期的账号
    if (user.loginCooldownUntil) {
      return;
    }
    
    // 检查最后登录时间（注册时间或最后登录时间）
    const loginTime = user.lastLoginTime || user.createdAt;
    
    if (loginTime) {
      const lastLogin = new Date(loginTime);
      
      // 如果最后登录在 7 天前（即第 8 天）
      if (lastLogin < sevenDaysAgo) {
        // 7 天没有登录，退出登录，设置 1 天冷却期
        const cooldownUntil = new Date(now.getTime() + oneDayInMs);
        user.loginCooldownUntil = cooldownUntil.toISOString();
        
        console.log(`账号 ${username} 因 7 天未登录，已进入冷却期，冷却至：${cooldownUntil.toISOString()}`);
        
        // 如果在在线列表中，通知用户
        if (onlineUsers.has(username)) {
          const socketId = onlineUsers.get(username);
          io.to(socketId).emit('account-locked', {
            message: '您的账号因 7 天未登录，已被暂时锁定，请 24 小时后再试',
            cooldownUntil: cooldownUntil.toISOString()
          });
        }
      }
    }
  });
}
