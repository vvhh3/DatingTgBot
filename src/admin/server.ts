import express from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/index.js";
import { getAllUsers, banUser, unbanUser, isUserBanned } from "../storage/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: config.botToken,
    resave: false,
    saveUninitialized: false,
  })
);

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!config.adminPassword) {
    return next();
  }
  if ((req.session as any).authenticated) {
    return next();
  }
  res.redirect("/login");
}

app.get("/login", (_req, res) => {
  res.render("login");
});

app.post("/login", (req, res) => {
  const { password } = req.body;
  if (password === config.adminPassword) {
    (req.session as any).authenticated = true;
    res.redirect("/");
  } else {
    res.render("login", { error: "Неверный пароль" });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.get("/", requireAuth, async (_req, res) => {
  const users = await getAllUsers();
  res.render("users", { users });
});

app.post("/ban/:userId", requireAuth, async (req, res) => {
  const userId = Number(req.params.userId);
  const already = await isUserBanned(userId);
  if (!already) {
    await banUser({
      userId,
      username: undefined,
      firstName: undefined,
      bannedByUserId: 0,
    });
  }
  res.redirect("/");
});

app.post("/unban/:userId", requireAuth, async (req, res) => {
  const userId = Number(req.params.userId);
  await unbanUser(userId);
  res.redirect("/");
});

if (config.adminPassword) {
  app.listen(config.port, () => {
    console.log(`Admin panel: http://localhost:${config.port}`);
  });
} else {
  console.log("Admin panel disabled (set ADMIN_PASSWORD to enable)");
}
