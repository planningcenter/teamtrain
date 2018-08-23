import config from "config"
import express from "express"
import bodyParser from "body-parser"
import redis from "async-redis"

import fetch from "node-fetch"

import http from "http"
import https from "https"

const app = express()
const slackConfig = config.get("slack")
const redisConfig = config.get("redis")
const redisClient = redis.createClient(redisConfig.port, redisConfig.host)

function shuffle(array) {
  var i = 0,
    j = 0,
    temp = null

  for (i = array.length - 1; i > 0; i -= 1) {
    j = Math.floor(Math.random() * (i + 1))
    temp = array[i]
    array[i] = array[j]
    array[j] = temp
  }
}

app.start = async () => {
  const port = config.get("port")
  console.log("starting at server at port", port)
  app.set("port", port)
  app.use(bodyParser.json())

  const server = http.createServer(app)

  app.post("/event", (req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" })
    const response = req.body
    if (response.token === slackConfig.railtie.verificationToken) {
      res.end(response.challenge)
    } else {
      res.end("not verified")
    }
  })

  app.get("/", (req, res) => {
    res.end("hooray! it works!")
  })

  app.post("/startTrain", async (req, res) => {
    const channel = await redisClient.get("railtie-message-channel")
    const timestamp = await redisClient.get("railtie-message-ts")

    const reactionsResponse = await fetch(
      `https://slack.com/api/reactions.get?channel=${channel}&timestamp=${timestamp}`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${slackConfig.railtie.token}`
        }
      }
    )

    const reactionJson = await reactionsResponse.json()
    if (!reactionJson.ok) {
      res.end("bad")
      return
    }

    const reactionUsers = reactionJson.message.reactions
      .filter(emoji => emoji.name == "ticket")[0]
      .users.filter(user => user != "UCE34NAFQ") // remove bot user

    shuffle(reactionUsers)

    var group
    while (reactionUsers.length > 0) {
      // create a group of 3 if odd number
      if (reactionUsers.length == 3) {
        group = reactionUsers.splice(0, 3).toString()
      } else {
        group = reactionUsers.splice(0, 2).toString()
      }

      fetch("https://slack.com/api/mpim.open", {
        method: "POST",
        body: JSON.stringify({ users: group }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${slackConfig.railtie.token}`
        }
      })
        .then(response => response.json())
        .then(json =>
          fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            body: JSON.stringify({ channel: json.group.id, text: "Testing Testing, test 1 2 3!" }),
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${slackConfig.railtie.token}`
            }
          })
            .then(ok => ok.json())
            .then(success => (!success.ok ? res.end("couldn't post") : success.toString()))
        )
    }
    res.end()
  })

  // entrance from cron?
  app.post("/postMessage", async (req, res) => {
    // TODO: verify sender before we do anything with Slack
    const mainMessageBody = {
      channel: slackConfig.railtie.channel,
      text:
        "All aboard! The train departs at 1:30 PM Pacific Time. Grab your :ticket: to join this train."
    }

    const postMessageResponse = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      body: JSON.stringify(mainMessageBody),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${slackConfig.railtie.token}`
      }
    })

    const messageJson = await postMessageResponse.json()

    if (!messageJson.ok) {
      res.end(messageJson.error)
      return
    }

    const reactionAddBody = {
      channel: messageJson.channel,
      timestamp: messageJson.ts,
      name: "ticket"
    }

    redisClient.set("railtie-message-channel", messageJson.channel)
    redisClient.set("railtie-message-ts", messageJson.ts)

    const reactionResponse = await fetch("https://slack.com/api/reactions.add", {
      method: "POST",
      body: JSON.stringify(reactionAddBody),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${slackConfig.railtie.token}`
      }
    })

    const reactionJson = await reactionResponse.json()

    if (!reactionJson.ok) {
      res.end(reactionJson.error)
      return
    }

    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(reactionJson.ok.toString())
  })

  server.listen(port)
}

app.start()

export default app
