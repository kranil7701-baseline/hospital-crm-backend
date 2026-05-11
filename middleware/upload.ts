import multer from "multer";
import path from "path";

const storage = multer.diskStorage({
    destination: (req: any, file: any, cb: any) => {
        cb(null, "uploads/");
    },
    filename: (req: any, file: any, cb: any) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    },
});

export const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024,
    },
    fileFilter: (req: any, file: any, cb: any) => {
        cb(null, true);
    },
});
