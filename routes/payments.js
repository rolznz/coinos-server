import store from "$lib/store.js";
import bc from "$lib/bitcoin.js";
import app from "$app.js";
import config from "$config/index.js";
import { auth, adminAuth, optionalAuth } from "$lib/passport.js";
import fs from "fs";
import { join } from "path";
import { Op } from "@sequelize/core";
import send from "./send.js";
import { warn } from "$lib/logging.js";

import btcRoutes from "./bitcoin/index.js";
import lnRoutes from "./lightning/index.js";
import lqRoutes from "./liquid/index.js";

app.post("/send", auth, send);
app.post("/sendToTokenHolders", auth, async (req, res, next) => {
  let { asset, amount } = req.body;

  let accounts = await db.Account.findAll({
    where: {
      asset,
      "$user.username$": { [Op.ne]: "gh" }
    },

    include: [{ model: db.User, as: "user" }]
  });

  let totalTokens = accounts.reduce((a, b) => a + b.balance, 0);
  console.log("TOTAL TOKENS", totalTokens);

  let totalSats = Math.floor(amount / totalTokens);

  console.log("TOTAL SATS", totalSats);

  if (totalSats < 1) throw new Error("amount is too low to distribute");

  for (let i = 0; i < accounts.length; i++) {
    let account = accounts[i];
    console.log(account.user.username, account.balance);
  }
  accounts.map(({ balance, user: { username } }) => ({ username, balance }));

  res.send({ success: "it worked" });
});

app.get("/except", adminAuth, (req, res) => {
  let s = fs.createWriteStream("exceptions", { flags: "a" });
  unaccounted.map(tx => s.write(tx.txid + "\n"));
  l("updated exceptions");
  res.send("updated exceptions");
});

if (config.lna) {
  app.post("/lightning/channel", lnRoutes.channel);
  app.post("/lightning/channelRequest", lnRoutes.channelRequest);
  app.post("/lightning/invoice", lnRoutes.invoice);
  app.post("/lightning/query", auth, lnRoutes.query);
  app.post("/lightning/send", auth, lnRoutes.send);
  import("./lightning/receive.js");
}

if (config.bitcoin) {
  app.post("/bitcoin/broadcast", optionalAuth, btcRoutes.broadcast);
  app.get("/bitcoin/generate", auth, btcRoutes.generate);
  app.post("/bitcoin/sweep", auth, btcRoutes.sweep);
  app.post("/bitcoin/fee", auth, btcRoutes.fee);
  app.post("/bitcoin/send", auth, btcRoutes.send);
  import("./bitcoin/receive.js");

  setTimeout(async () => {
    try {
      const address = await bc.getNewAddress();
      const { hdkeypath } = await bc.getAddressInfo(address);
      const parts = hdkeypath.split("/");
      store.bcAddressIndex = parts[parts.length - 1].replace("'", "");
    } catch (e) {
      console.error(e);
    }
  }, 50);
}

if (config.liquid) {
  app.post("/liquid/broadcast", optionalAuth, lqRoutes.broadcast);
  app.get("/liquid/generate", auth, lqRoutes.generate);
  // app.post("/liquid/fee", auth, lqRoutes.fee);
  app.post("/liquid/send", auth, lqRoutes.send);
  // app.post("/taxi", auth, lqRoutes.taxi);
  import("./liquid/receive.js");

  setTimeout(async () => {
    try {
      const address = await lq.getNewAddress();
      const { hdkeypath } = await lq.getAddressInfo(address);
      const parts = hdkeypath.split("/");
      store.lqAddressIndex = parts[parts.length - 1].slice(0, -1);
    } catch (e) {
      warn("Problem getting liquid address index", e.message);
    }
  }, 50);
}

app.get("/payments", auth, async (req, res) => {
  if (!req.user.account_id) return res.send([]);
  let payments = await db.Payment.findAll({
    where: {
      account_id: req.user.account_id
    },
    order: [["id", "DESC"]],
    include: {
      model: db.Account,
      as: "account"
    }
  });

  res.send(payments);
});

app.get("/payment/:redeemcode", async (req, res) => {
  try {
    const { redeemcode } = req.params;
    let payment = await db.Payment.findOne({
      where: {
        redeemcode
      },
      include: {
        model: db.Account,
        as: "account"
      }
    });

    if (!payment) fail("invalid code");

    res.send(payment);
  } catch (e) {
    res.status(500).send(e.message);
  }
});
