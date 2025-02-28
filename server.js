const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
});
app.use(cors());
app.use(express.static("public"));

// Store users by group
let groups = {
    group1: { users: {}, messages: [] },
    group2: { users: {}, messages: [] },
    group3: { users: {}, messages: [] }
};

io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);
    
    // User joins with a username and group
    socket.on("join", (data) => {
        const { username, group } = data;
        
        // Validate the group
        if (!groups[group]) {
            socket.emit("errorMessage", "Invalid group selection");
            return;
        }
        
        // Check if username is already taken in this group
        if (Object.values(groups[group].users).some(user => user.username === username)) {
            socket.emit("errorMessage", "Username already taken in this group! Choose another.");
            return;
        }
        
        // Add user to the group
        groups[group].users[socket.id] = {
            username,
            socketId: socket.id,
            lastSeen: "Online",
            active: true
        };
        
        // Join socket room for this group
        socket.join(group);
        
        // Let the user know they're joined
        socket.emit("userJoined", { username, group });
        
        // Notify others in the group that a new user joined
        socket.to(group).emit("userJoined", { username, group });
        
        // Send updated user list to all clients in the group
        io.to(group).emit("updateUsers", groups[group].users);
        
        // Send recent message history to the new user
        const recentMessages = groups[group].messages.slice(-20); // Last 20 messages
        socket.emit("messageHistory", recentMessages);
    });
    
    // User sends a message
    socket.on("sendMessage", (data) => {
        const { username, message, group, replyTo } = data;
        
        // Make sure user is in this group
        if (!groups[group] || !groups[group].users[socket.id]) {
            return;
        }
        
        // Create message object with unique ID
        const timestamp = new Date().toLocaleTimeString();
        const messageId = Date.now() + Math.random().toString(36).substr(2, 5);
        
        const messageObj = {
            id: messageId,
            username,
            message,
            timestamp,
            group,
            replyTo,
            reactions: {},
            readBy: [socket.id] // Sender has read the message
        };
        
        // Store the message
        groups[group].messages.push(messageObj);
        
        // Broadcast to all in the group including sender
        io.to(group).emit("receiveMessage", messageObj);
    });
    
    // User is typing
    socket.on("typing", (data) => {
        const { username, group } = data;
        socket.to(group).emit("userTyping", { username, group });
    });
    
    // User stopped typing
    socket.on("stopTyping", (data) => {
        const { group } = data;
        socket.to(group).emit("userStopTyping", { group });
    });
    
    // User added a reaction to a message
    socket.on("addReaction", (data) => {
        const { messageId, reaction, username, group } = data;
        
        // Find the message in the group's messages
        const message = groups[group].messages.find(msg => msg.id === messageId);
        
        if (message) {
            // Initialize reactions object for this emoji if needed
            if (!message.reactions[reaction]) {
                message.reactions[reaction] = [];
            }
            
            // Check if user already reacted with this emoji
            const userIndex = message.reactions[reaction].indexOf(username);
            
            if (userIndex !== -1) {
                // Remove reaction if already exists (toggle behavior)
                message.reactions[reaction].splice(userIndex, 1);
                
                // If no users left for this reaction, remove the reaction
                if (message.reactions[reaction].length === 0) {
                    delete message.reactions[reaction];
                }
            } else {
                // Add user to this reaction
                message.reactions[reaction].push(username);
            }
            
            // Broadcast updated reaction to all users in the group
            for (const [emoji, users] of Object.entries(message.reactions)) {
                io.to(group).emit("messageReaction", {
                    messageId,
                    reaction: emoji,
                    username,
                    count: users.length,
                    group
                });
            }
        }
    });
    
    // User has read a message
    socket.on("readMessage", (data) => {
        const { username, messageId } = data;
        
        // Find the message across all groups
        for (const [groupName, groupData] of Object.entries(groups)) {
            const message = groupData.messages.find(msg => msg.id === messageId);
            
            if (message && !message.readBy.includes(socket.id)) {
                message.readBy.push(socket.id);
                
                // Could emit an event for read receipts if needed
                io.to(groupName).emit("messageRead", {
                    messageId,
                    readBy: message.readBy.map(id => {
                        return groups[groupName].users[id] ? 
                               groups[groupName].users[id].username : null;
                    }).filter(Boolean)
                });
            }
        }
    });
    
    // User became active (focused window)
    socket.on("userActive", (data) => {
        const { username, group } = data;
        
        if (groups[group] && groups[group].users[socket.id]) {
            groups[group].users[socket.id].lastSeen = "Online";
            groups[group].users[socket.id].active = true;
            
            // Notify other users that this user is active
            io.to(group).emit("updateUsers", groups[group].users);
        }
    });
    
    // User became inactive (blurred window)
    socket.on("userInactive", (data) => {
        const { username, group } = data;
        
        if (groups[group] && groups[group].users[socket.id]) {
            const now = new Date();
            groups[group].users[socket.id].lastSeen = now.toLocaleTimeString();
            groups[group].users[socket.id].active = false;
            
            // Notify other users that this user is inactive
            io.to(group).emit("updateUsers", groups[group].users);
        }
    });
    
    // User leaves chat
    socket.on("leaveChat", (data) => {
        const { username, group } = data;
        handleDisconnect(socket.id, group);
    });
    
    // User disconnects
    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
        
        // Check all groups for this socket
        for (const [groupName, groupData] of Object.entries(groups)) {
            if (groupData.users[socket.id]) {
                handleDisconnect(socket.id, groupName);
            }
        }
    });
    
    // Helper function to handle user disconnection/leaving
    function handleDisconnect(socketId, group) {
        if (groups[group] && groups[group].users[socketId]) {
            const username = groups[group].users[socketId].username;
            
            // Remove user from the group
            delete groups[group].users[socketId];
            
            // Notify others that user has left
            io.to(group).emit("userLeft", { username, group });
            
            // Update user list for others
            io.to(group).emit("updateUsers", groups[group].users);
        }
    }
});

// Clean up inactive messages periodically (optional)
setInterval(() => {
    for (const group in groups) {
        // Limit each group to the last 200 messages
        if (groups[group].messages.length > 200) {
            groups[group].messages = groups[group].messages.slice(-200);
        }
    }
}, 3600000); // Run every hour

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});