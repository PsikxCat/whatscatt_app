import { ConvexError, v } from 'convex/values'
import { mutation, query, internalMutation } from './_generated/server'
import { internal } from './_generated/api'

export const sendTextMessage = mutation({
  args: {
    senderId: v.union(v.id('users'), v.string()),
    content: v.string(),
    chatId: v.id('chats'),
  },
  handler: async ({ auth, db, scheduler }, { content, senderId, chatId }) => {
    const identity = await auth.getUserIdentity()
    if (!identity) throw new ConvexError('No autenticado')

    const user = await db
      .query('users')
      .withIndex('by_tokenIdentifier', (q) => q.eq('tokenIdentifier', identity.tokenIdentifier))
      .unique()

    if (!user) throw new ConvexError('Usuario no encontrado')

    const chat = await db
      .query('chats')
      .filter((q) => q.eq(q.field('_id'), chatId))
      .first()

    if (!chat) throw new ConvexError('Chat no encontrado')
    if (!chat.members.includes(user._id)) throw new ConvexError('No eres miembro de este chat')

    // Si se encontro el chat y el usuario es miembro, se inserta el mensaje
    await db.insert('messages', {
      content,
      sender: senderId,
      chat: chatId,
      messageType: 'text',
    })

    // Si el mensaje es del chatbot, se envia a gemini
    if (content.startsWith('@bot')) {
      try {
        console.log('Intentando ejecutar funcion chat de Gemini')
        // > Pendiente error: EL SCHEDULER NO EJECUTA CHAT DE CONVEX/GEMINI.TS POR LO CUAL EL BOT NO FUNCIONA
        const cxScheduler = await scheduler.runAfter(0, internal.gemini.chat, {
          chat: chatId,
          content,
        })
        console.log('Scheduler para funcion chat de Gemini ejecutado', cxScheduler)
      } catch (error) {
        console.error('Error al programar la acción:', error)
      }
    }
  },
})

export const sendGeminiMessage = internalMutation({
  args: {
    chatId: v.id('chats'),
    content: v.string(),
  },
  handler: async ({ db }, { chatId, content }) => {
    console.log('sendGeminiMessage function', chatId, content)

    await db.insert('messages', {
      content,
      sender: 'Gemini',
      chat: chatId,
      messageType: 'text',
    })
  },
})

export const sendImageMessage = mutation({
  args: {
    senderId: v.id('users'),
    chatId: v.id('chats'),
    media: v.id('_storage'),
  },
  handler: async ({ auth, storage, db }, { senderId, chatId, media }) => {
    const identity = await auth.getUserIdentity()
    if (!identity) throw new ConvexError('No autenticado')

    const content = (await storage.getUrl(media)) as string

    await db.insert('messages', {
      content,
      sender: senderId,
      chat: chatId,
      messageType: 'image',
      fileStorageId: media,
    })
  },
})

export const sendVideoMessage = mutation({
  args: {
    senderId: v.id('users'),
    chatId: v.id('chats'),
    media: v.id('_storage'),
  },
  handler: async ({ auth, storage, db }, { senderId, chatId, media }) => {
    const identity = await auth.getUserIdentity()
    if (!identity) throw new ConvexError('No autenticado')

    const content = (await storage.getUrl(media)) as string

    await db.insert('messages', {
      content,
      sender: senderId,
      chat: chatId,
      messageType: 'video',
      fileStorageId: media,
    })
  },
})

export const getMessages = query({
  args: {
    chatId: v.id('chats'),
  },
  handler: async ({ auth, db }, { chatId }) => {
    const identity = await auth.getUserIdentity()
    if (!identity) throw new ConvexError('No autenticado')

    const messages = await db
      .query('messages')
      .withIndex('by_chat', (q) => q.eq('chat', chatId))
      .collect()

    const userProfileCache = new Map()

    const detailMessages = await Promise.all(
      messages.map(async (message) => {
        let sender

        // Verificar si el perfil del usuario ya esta en cache
        if (userProfileCache.has(message.sender)) {
          sender = userProfileCache.get(message.sender)
        } else {
          // Si no esta en cache, se busca en la base de datos
          sender = await db
            .query('users')
            .filter((q) => q.eq(q.field('_id'), message.sender))
            .first()

          // Se guarda en cache para futuras referencias
          userProfileCache.set(message.sender, sender)
        }

        return {
          ...message,
          sender,
        }
      }),
    )

    return detailMessages
  },
})

export const deleteMessage = mutation({
  args: {
    messageId: v.id('messages'),
  },
  handler: async ({ auth, db, storage }, { messageId }) => {
    const identity = await auth.getUserIdentity()
    if (!identity) throw new ConvexError('No autenticado')

    const message = await db.get(messageId)
    if (!message) throw new ConvexError('Mensaje no encontrado')

    const chat = await db.get(message.chat)
    if (!chat) throw new ConvexError('Chat no encontrado')

    const user = await db
      .query('users')
      .filter((q) => q.eq(q.field('_id'), message.sender))
      .first()

    if (!user) throw new ConvexError('Usuario no encontrado')

    // if (identity.tokenIdentifier !== user.tokenIdentifier) throw new ConvexError('No autorizado')

    if (message.messageType === 'image' || message.messageType === 'video') {
      const storageId = message.fileStorageId
      if (storageId) await storage.delete(storageId)
    }

    await db.delete(messageId)
  },
})
