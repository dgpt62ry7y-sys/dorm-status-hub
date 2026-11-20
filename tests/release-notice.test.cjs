const path = require('node:path')
const {
  createMemoryDatabase,
  installCloudBaseMock,
} = require('./support/memory-cloudbase.cjs')

const database = createMemoryDatabase()
const restoreCloudBase = installCloudBaseMock(database)
const backend = require(path.join(__dirname, '..', 'cloudfunctions', 'api', 'index.js'))
restoreCloudBase()

async function invoke(payload) {
  const response = await backend.main({
    httpMethod: 'POST',
    body: JSON.stringify(payload),
  })
  return JSON.parse(response.body)
}

function ok(result, label) {
  if (!result.ok) throw new Error(`${label}: ${result.error.code} ${result.error.message}`)
  return result.data
}

async function run() {
  const suffix = String(Date.now()).slice(-6)
  const owner = ok(
    await invoke({
      action: 'createRoom',
      roomName: `公告测试${suffix}`,
      nickname: `公告房主${suffix}`,
      deviceLabel: 'Release Test Owner',
      capacity: 4,
    }),
    'create room',
  )

  if (
    !owner.state.releaseNotice ||
    owner.state.releaseNotice.fromVersion !== '1.0.0' ||
    owner.state.releaseNotice.toVersion !== '1.3.0'
  ) {
    throw new Error('New owner did not receive the full release summary')
  }
  if (owner.state.releaseNotice.items.length < 6) {
    throw new Error('Full release summary is incomplete')
  }

  const ownerPoll = ok(
    await invoke({ action: 'getState', memberToken: owner.memberToken }),
    'owner poll',
  )
  if (ownerPoll.releaseNotice) throw new Error('Background poll repeated release notice')

  const joined = ok(
    await invoke({
      action: 'joinRoom',
      inviteCode: owner.state.room.inviteCode,
      nickname: `公告成员${suffix}`,
      deviceLabel: 'Release Test Member',
    }),
    'join room',
  )
  if (!joined.state.releaseNotice || joined.state.releaseNotice.fromVersion !== '1.0.0') {
    throw new Error('New member did not receive the full release summary')
  }

  const link = ok(
    await invoke({
      action: 'createDeviceLink',
      memberToken: joined.memberToken,
    }),
    'create second device link',
  )
  const joinedSecond = ok(
    await invoke({
      action: 'claimDeviceLink',
      code: link.code,
      deviceLabel: 'Release Test Member Second',
    }),
    'claim second device',
  )

  const memberRecord = database.data
    .get('members')
    .find((member) => member._id === joined.state.currentMemberId)
  memberRecord.lastSeenReleaseVersion = '1.1.0'
  const claimRows = database.data.get('releaseClaims')
  for (let index = claimRows.length - 1; index >= 0; index -= 1) {
    if (claimRows[index].memberId === joined.state.currentMemberId) claimRows.splice(index, 1)
  }

  const [firstAccess, secondAccess] = await Promise.all([
    invoke({
      action: 'getState',
      memberToken: joined.memberToken,
      claimReleaseNotice: true,
    }),
    invoke({
      action: 'getState',
      memberToken: joinedSecond.memberToken,
      claimReleaseNotice: true,
    }),
  ])
  const delivered = [
    { token: joined.memberToken, result: firstAccess },
    { token: joinedSecond.memberToken, result: secondAccess },
  ].filter(({ result }) => result.ok && result.data.releaseNotice)
  if (delivered.length !== 1) {
    throw new Error('Release notice was not claimed exactly once per account')
  }

  const notice = delivered[0].result.data.releaseNotice
  if (notice.fromVersion !== '1.1.0' || notice.toVersion !== '1.3.0') {
    throw new Error('Release range does not match last seen version')
  }
  if (
    !notice.items.some((item) => item.includes('四人寝或六人寝')) ||
    !notice.items.some((item) => item.includes('集中提示'))
  ) {
    throw new Error('Missed release items were not aggregated')
  }

  ok(
    await invoke({
      action: 'acknowledgeReleaseNotice',
      memberToken: delivered[0].token,
      noticeId: notice.id,
    }),
    'acknowledge release notice',
  )

  const acknowledgedClaim = database.data
    .get('releaseClaims')
    .find((claim) => claim._id === notice.id)
  if (!acknowledgedClaim?.acknowledgedAt) {
    throw new Error('Release acknowledgement was not recorded')
  }

  const noRepeat = ok(
    await invoke({
      action: 'getState',
      memberToken: joined.memberToken,
      claimReleaseNotice: true,
    }),
    'getState after acknowledgement',
  )
  if (noRepeat.releaseNotice) throw new Error('Release notice repeated after acknowledgement')

  console.log(
    JSON.stringify(
      {
        fullSummaryForNewAccounts: true,
        missedReleasesAggregated: true,
        firstDeviceOnly: true,
        pollingDoesNotConsumeReleaseNotice: true,
        acknowledgementPersisted: true,
        noRepeatAfterAcknowledgement: true,
      },
      null,
      2,
    ),
  )
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
