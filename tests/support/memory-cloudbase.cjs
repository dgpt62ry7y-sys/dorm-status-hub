function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createMemoryDatabase() {
  const data = new Map()
  let counter = 0

  function rows(name) {
    if (!data.has(name)) data.set(name, [])
    return data.get(name)
  }

  function matches(row, query) {
    return Object.entries(query).every(([key, value]) => row[key] === value)
  }

  class Query {
    constructor(name, query = {}) {
      this.name = name
      this.query = query
      this.max = Infinity
      this.offset = 0
    }

    where(query) {
      this.query = query
      return this
    }

    limit(max) {
      this.max = max
      return this
    }

    skip(offset) {
      this.offset = offset
      return this
    }

    async get() {
      return {
        data: rows(this.name)
          .filter((row) => matches(row, this.query))
          .slice(this.offset, this.offset + this.max)
          .map(clone),
      }
    }

    async add(value) {
      let id = value?._id
      if (!id) {
        counter += 1
        id = `${this.name}-${counter}`
      }
      if (rows(this.name).some((row) => row._id === id)) {
        throw new Error(`Duplicate key: ${id}`)
      }
      rows(this.name).push({ ...clone(value), _id: id })
      return { id }
    }

    async update(patch) {
      const matched = rows(this.name)
        .filter((row) => matches(row, this.query))
        .slice(0, this.max)
      for (const row of matched) Object.assign(row, clone(patch))
      return { updated: matched.length }
    }
  }

  class Collection extends Query {
    doc(id) {
      const name = this.name
      return {
        async get() {
          const row = rows(name).find((item) => item._id === id)
          if (!row) {
            const error = new Error('Document not found')
            error.code = 'DOCUMENT_NOT_FOUND'
            throw error
          }
          return { data: [clone(row)] }
        },
        async set(value) {
          const index = rows(name).findIndex((item) => item._id === id)
          const next = { ...clone(value), _id: id }
          if (index >= 0) rows(name)[index] = next
          else rows(name).push(next)
          return { id }
        },
        async update(patch) {
          const row = rows(name).find((item) => item._id === id)
          if (!row) throw new Error(`Missing ${name}/${id}`)
          Object.assign(row, clone(patch))
          return { updated: 1 }
        },
        async delete() {
          const index = rows(name).findIndex((item) => item._id === id)
          if (index >= 0) rows(name).splice(index, 1)
          return { deleted: index >= 0 ? 1 : 0 }
        },
      }
    }
  }

  return {
    data,
    collection(name) {
      return new Collection(name)
    },
    async createCollection(name) {
      rows(name)
    },
    async runTransaction(callback) {
      return callback(this)
    },
  }
}

function installCloudBaseMock(database) {
  const Module = require('node:module')
  const originalLoad = Module._load
  const cloudbase = {
    SYMBOL_CURRENT_ENV: 'test-env',
    init() {
      return { database: () => database }
    },
  }
  Module._load = function load(request, parent, isMain) {
    if (request === '@cloudbase/node-sdk') return cloudbase
    return originalLoad.call(this, request, parent, isMain)
  }
  return () => {
    Module._load = originalLoad
  }
}

module.exports = {
  createMemoryDatabase,
  installCloudBaseMock,
}
