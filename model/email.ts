// import mongoose, { Document, Schema } from "mongoose";

// export interface IEmailRecipient {
//   name?: string;
//   address: string;
// }

// export interface IEmail extends Document {
//   graphId: string;
//   sender: IEmailRecipient;
//   from: IEmailRecipient;
//   toRecipients: IEmailRecipient[];
//   ccRecipients: IEmailRecipient[];
//   bccRecipients: IEmailRecipient[];
//   subject: string;
//   normalizedSubject: string;
//   bodyPreview: string;
//   body: {
//     contentType: string;
//     content: string;
//   };
//   receivedDateTime: Date;
//   sentDateTime: Date;
//   hasAttachments: boolean;
//   isRead: boolean;
//   isDraft: boolean;
//   webLink: string;
//   conversationId: string;
//   importance: string;
//   attachments?: {
//     name: string;
//     contentType: string;
//     contentId: string;
//     contentBytes: string;
//     fileUrl?: string;
//     isInline: boolean;
//   }[];
//   crmUser: mongoose.Types.ObjectId;
//   createdAt: Date;
//   updatedAt: Date;
// }

// const RecipientSchema = new Schema(
//   {
//     name: { type: String, trim: true },
//     address: { type: String, required: true, trim: true, lowercase: true },
//   },
//   { _id: false },
// );

// const EmailSchema = new Schema<IEmail>(
//   {
//     graphId: {
//       type: String,
//       required: true,
//       unique: true,
//       index: true,
//     },
//     sender: RecipientSchema,
//     from: RecipientSchema,
//     toRecipients: [RecipientSchema],
//     ccRecipients: [RecipientSchema],
//     bccRecipients: [RecipientSchema],
//     subject: {
//       type: String,
//       trim: true,
//     },
//     normalizedSubject: {
//       type: String,
//       trim: true,
//       index: true,
//     },
//     bodyPreview: {
//       type: String,
//     },
//     body: {
//       contentType: { type: String },
//       content: { type: String },
//     },
//     receivedDateTime: {
//       type: Date,
//     },
//     sentDateTime: {
//       type: Date,
//     },
//     hasAttachments: {
//       type: Boolean,
//       default: false,
//     },
//     isRead: {
//       type: Boolean,
//       default: false,
//     },
//     isDraft: {
//       type: Boolean,
//       default: false,
//     },
//     webLink: {
//       type: String,
//     },
//     conversationId: {
//       type: String,
//     },
//     importance: {
//       type: String,
//       enum: ["low", "normal", "high"],
//       default: "normal",
//     },
//     crmUser: {
//       type: Schema.Types.ObjectId,
//       ref: "User",
//       required: true,
//     },
//     attachments: [
//       {
//         name: { type: String },
//         contentType: { type: String },
//         contentId: { type: String },
//         contentBytes: { type: String },
//         fileUrl: { type: String },
//         isInline: { type: Boolean, default: false },
//       },
//     ],
//   },
//   {
//     timestamps: true,
//   },
// );

// // Index for faster searches
// EmailSchema.index({ crmUser: 1, receivedDateTime: -1 });
// EmailSchema.index({ subject: "text", bodyPreview: "text" });

// const Email = mongoose.model<IEmail>("Email", EmailSchema);

// export default Email;








import mongoose, { Document, Schema, Types } from "mongoose";

export interface IEmailRecipient {
  name?: string;
  address: string;
}

export interface IEmailAttachment {
  name: string;
  contentType: string;
  contentId: string;
  contentBytes: string;
  fileUrl?: string;
  isInline: boolean;
}

export interface IEmail extends Document {
  graphId: string;

  crmUser: Types.ObjectId;

  sender?: IEmailRecipient;
  from?: IEmailRecipient;

  toRecipients: IEmailRecipient[];
  ccRecipients: IEmailRecipient[];
  bccRecipients: IEmailRecipient[];

  subject?: string;
  normalizedSubject?: string;

  bodyPreview?: string;

  body?: {
    contentType?: string;
    content?: string;
  };

  receivedDateTime?: Date;
  sentDateTime?: Date;

  hasAttachments: boolean;
  isRead: boolean;
  isDraft: boolean;

  webLink?: string;
  conversationId?: string;

  importance: "low" | "normal" | "high";

  attachments?: IEmailAttachment[];

  createdAt: Date;
  updatedAt: Date;
}

const RecipientSchema = new Schema<IEmailRecipient>(
  {
    name: { type: String, trim: true },
    address: { type: String, required: true, trim: true, lowercase: true },
  },
  { _id: false }
);

const AttachmentSchema = new Schema<IEmailAttachment>(
  {
    name: String,
    contentType: String,
    contentId: String,
    contentBytes: String,
    fileUrl: String,
    isInline: { type: Boolean, default: false },
  },
  { _id: false }
);

const EmailSchema = new Schema<IEmail>(
  {
    graphId: {
      type: String,
      required: true,
      index: true,
    },

    crmUser: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    sender: RecipientSchema,
    from: RecipientSchema,

    toRecipients: [RecipientSchema],
    ccRecipients: [RecipientSchema],
    bccRecipients: [RecipientSchema],

    subject: { type: String, trim: true },

    normalizedSubject: {
      type: String,
      trim: true,
      index: true,
    },

    bodyPreview: String,

    body: {
      contentType: String,
      content: String,
    },

    receivedDateTime: { type: Date, index: true },
    sentDateTime: Date,

    hasAttachments: { type: Boolean, default: false },
    isRead: { type: Boolean, default: false },
    isDraft: { type: Boolean, default: false },

    webLink: String,
    conversationId: { type: String, index: true },

    importance: {
      type: String,
      enum: ["low", "normal", "high"],
      default: "normal",
    },

    attachments: [AttachmentSchema],
  },
  {
    timestamps: true,
  }
);

// 🔥 IMPORTANT INDEXES
EmailSchema.index(
  { crmUser: 1, receivedDateTime: -1 },
  { background: true }
);

EmailSchema.index(
  { graphId: 1, crmUser: 1 },
  { unique: true }
);

EmailSchema.index(
  { subject: "text", bodyPreview: "text", "body.content": "text" }
);

EmailSchema.index({ conversationId: 1 });

// 🚀 IMPORTANT for production performance
EmailSchema.set("autoIndex", false);

export default mongoose.model<IEmail>("Email", EmailSchema);