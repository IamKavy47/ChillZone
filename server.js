const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "https://chillzone-xkiq.onrender.com/",  // Replace with your actual client domain
        methods: ["GET", "POST"],
        credentials: true, // Allow credentials if needed (cookies, etc.)
    },
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

    // ... [Other event handlers remain unchanged]
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

// OnRender uses dynamic ports, so use the environment variable to determine the port.
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
