const reverse = require("buffer-reverse");
const zmq = require("zeromq");
const { Op } = require("sequelize");

const bitcoin = require("bitcoinjs-lib");

const zmqRawBlock = zmq.socket("sub");
zmqRawBlock.connect(config.bitcoin.zmqrawblock);
zmqRawBlock.subscribe("rawblock");

const zmqRawTx = zmq.socket("sub");
zmqRawTx.connect(config.bitcoin.zmqrawtx);
zmqRawTx.subscribe("rawtx");

let NETWORK = bitcoin.networks[config.bitcoin.network === "mainnet" ? "bitcoin" : config.bitcoin.network];

zmqRawTx.on("message", async (topic, message, sequence) => {
  const hex = message.toString("hex");
  let tx = bitcoin.Transaction.fromHex(message);
  let hash = reverse(tx.getHash()).toString("hex");

  if (payments.includes(hash)) return;

  Promise.all(
    tx.outs.map(async o => {
      const { value } = o;

      let address;
      try {
        address = bitcoin.address.fromOutputScript(
          o.script,
          NETWORK
        );
      } catch (e) {
        return;
      }

      if (Object.keys(addresses).includes(address)) {
        payments.push(hash);

        let user = await db.User.findOne({
          where: {
            username: addresses[address]
          }
        });

        let invoices = await db.Payment.findAll({
          limit: 1,
          where: {
            address,
            received: null,
            amount: {
              [Op.gt]: 0
            }
          },
          order: [["createdAt", "DESC"]]
        });

        let tip = null;
        if (invoices.length) tip = invoices[0].tip;

        let confirmed = false;

        user.address = await bc.getNewAddress("", "bech32");
        user.pending += value;

        await user.save();
        emit(user.username, "user", user);
        
        addresses[user.address] = user.username;

        const payment = await db.Payment.create({
          user_id: user.id,
          hash,
          amount: value,
          currency: user.currency,
          rate: app.get("rates")[user.currency],
          received: true,
          tip,
          confirmed,
          address,
          asset: 'BTC',
        });

        l.info("bitcoin detected", user.username, o.value);
        emit(user.username, "payment", payment);
      }
    })
  );
});

let queue = {};

zmqRawBlock.on("message", async (topic, message, sequence) => {
  const payments = await db.Payment.findAll({
    where: { confirmed: false }
  });

  const hashes = payments.map(p => p.hash);

  let block = bitcoin.Block.fromHex(message.toString("hex"));
  block.transactions.map(tx => {
    let hash = reverse(tx.getHash()).toString("hex");
    if (hashes.includes(hash)) queue[hash] = 1;
  }); 
});

setInterval(async () => {
  let arr = Object.keys(queue);
  for (let i = 0; i < arr.length; i++) {
    let hash = arr[i];

    let p = await db.Payment.findOne({
      include: [{ model: db.User, as: "user" }],
      where: { hash, confirmed: 0 }
    })

    p.confirmed = 1;

    let user = await p.getUser();
    user.balance += p.amount;
    user.pending -= Math.min(user.pending, p.amount);
    emit(user.username, "user", user);

    await user.save();
    await p.save();

    let payments = await db.Payment.findAll({
      where: { 
        user_id: user.id,
        received: { 
          [Op.ne]: null
        },
      },
      order: [['id', 'DESC']],
      limit: 12
    });

    l.info("bitcoin confirmed", user.username, p.amount);
    emit(user.username, "payments", payments);
    delete queue[hash];
  }
}, 1000);
