// app.js
const LiteZ = require("./litez");

// Back-end Setup
LiteZ.db.connect(":memory:");
LiteZ.db.run("CREATE TABLE users (id INTEGER, name TEXT)");

LiteZ.server.route("GET", "/api/users", async () => {
  const users = await LiteZ.db.all("SELECT * FROM users");
  return { users };
});

LiteZ.server.route("POST", "/api/users", async (req) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  return new Promise((resolve) => {
    req.on("end", async () => {
      const { id, name } = JSON.parse(body);
      await LiteZ.db.run("INSERT INTO users (id, name) VALUES (?, ?)", [id, name]);
      resolve({ success: true });
    });
  });
});

LiteZ.server.listen(3000, () => console.log("Server running on port 3000"));

// Front-end Component
LiteZ.component("UserList", {
  template: `
    <div>
      <h2>User List</h2>
      <ul>
        <li z-for="user in state.users">{{user.name}}</li>
      </ul>
      <input z-model="state.newUser" placeholder="Enter new user">
      <button @click="addUser">Add User</button>
    </div>
  `,
  data: () => ({ users: [], newUser: "" }),
  methods: {
    async addUser(state) {
      await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: Date.now(), name: state.newUser }),
      });
      const res = await fetch("/api/users");
      state.users = (await res.json()).users;
      state.newUser = "";
    },
  },
  on: {
    async created(state) {
      const res = await fetch("/api/users");
      state.users = (await res.json()).users;
    },
  },
});

// Mount the App (for browser environment)
if (typeof window !== "undefined") {
  LiteZ.createApp({
    template: "<user-list></user-list>",
  }).mount("#app");
}

module.exports = LiteZ;