import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/email';
import { upload } from '../middleware/upload';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET no está configurado en las variables de entorno');

const EMAIL_REGEX = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      include: { specialist: true } // Include specialist data if they are one
    });
    
    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Block unverified alumni
    if (user.role === 'alumno' && !user.emailVerified) {
      return res.status(403).json({ code: 'EMAIL_NOT_VERIFIED', error: 'Debes verificar tu correo antes de iniciar sesión.' });
    }

    // Generate token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Remove password from object before sending
    const { password: _, ...userWithoutPassword } = user;
    
    res.json({
      token,
      user: userWithoutPassword
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const data = req.body;

    // Validate email format
    if (!data.email || !EMAIL_REGEX.test(data.email)) {
      return res.status(400).json({ error: 'El formato del correo no es válido' });
    }

    // Validate institutional email domain
    const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN;
    if (allowedDomain && data.email) {
      const emailDomain = data.email.split('@')[1];
      if (emailDomain !== allowedDomain) {
        return res.status(400).json({ error: `Solo se permiten correos institucionales (@${allowedDomain})` });
      }
    }

    // Check if user exists
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      return res.status(400).json({ error: 'El correo ya está registrado' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(data.password, salt);
    
    // Create user with verification token (expires in 24h)
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        name: data.name,
        role: 'alumno', // Siempre alumno en registro público — admins/especialistas se crean por admin
        matricula: data.matricula || null,
        carrera: data.carrera || null,
        semestre: data.semestre ? Number(data.semestre) : null,
        edad: data.edad ? Number(data.edad) : null,
        genero: data.genero || null,
        emailVerified: false,
        verificationToken,
        verificationTokenExpiresAt,
      }
    });

    // Send verification email (non-blocking)
    sendVerificationEmail(user.name, user.email, verificationToken).catch(err => {
      console.error('Error sending verification email:', err);
    });

    res.status(201).json({ message: 'Registro exitoso. Revisa tu correo para verificar tu cuenta.' });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Error registrando usuario' });
  }
});

// GET /api/auth/verify/:token
router.get('/verify/:token', async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  try {
    const user = await prisma.user.findFirst({
      where: { verificationToken: req.params.token }
    });

    if (!user) {
      return res.redirect(`${frontendUrl}?verified=false`);
    }

    if (user.verificationTokenExpiresAt && user.verificationTokenExpiresAt < new Date()) {
      return res.redirect(`${frontendUrl}?verified=expired`);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, verificationToken: null, verificationTokenExpiresAt: null }
    });

    res.redirect(`${frontendUrl}?verified=true`);
  } catch (error) {
    console.error('Verification error:', error);
    res.redirect(`${frontendUrl}?verified=false`);
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    // Always respond OK to avoid leaking which emails exist
    if (!user || user.emailVerified) {
      return res.json({ message: 'Si el correo existe y no está verificado, recibirás un nuevo enlace.' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: user.id },
      data: { verificationToken, verificationTokenExpiresAt }
    });

    sendVerificationEmail(user.name, user.email, verificationToken).catch(err => {
      console.error('Error resending verification email:', err);
    });

    res.json({ message: 'Si el correo existe y no está verificado, recibirás un nuevo enlace.' });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    // Always respond OK to avoid leaking which emails exist
    if (!user) {
      return res.json({ message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' });
    }

    const resetPasswordToken = crypto.randomBytes(32).toString('hex');
    const resetPasswordTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: { resetPasswordToken, resetPasswordTokenExpiresAt }
    });

    sendPasswordResetEmail(user.name, user.email, resetPasswordToken).catch(err => {
      console.error('Error sending reset email:', err);
    });

    res.json({ message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password || password.length < 6) {
      return res.status(400).json({ error: 'Token y contraseña (mínimo 6 caracteres) son requeridos' });
    }

    const user = await prisma.user.findFirst({
      where: { resetPasswordToken: token }
    });

    if (!user) {
      return res.status(400).json({ code: 'INVALID_TOKEN', error: 'El enlace no es válido.' });
    }

    if (user.resetPasswordTokenExpiresAt && user.resetPasswordTokenExpiresAt < new Date()) {
      return res.status(400).json({ code: 'EXPIRED_TOKEN', error: 'El enlace ha expirado. Solicita uno nuevo.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, resetPasswordToken: null, resetPasswordTokenExpiresAt: null }
    });

    res.json({ message: 'Contraseña actualizada correctamente.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PATCH /api/auth/avatar
router.patch('/avatar', verifyToken as any, upload.single('avatar'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se proporcionó imagen' });
    const avatarUrl = `/uploads/${req.file.filename}`;
    await prisma.user.update({ where: { id: req.user!.id }, data: { avatarUrl } });
    res.json({ avatarUrl });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Contraseña actual y nueva contraseña (mínimo 6 caracteres) son requeridas' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ code: 'WRONG_PASSWORD', error: 'La contraseña actual es incorrecta' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword }
    });

    res.json({ message: 'Contraseña actualizada correctamente.' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/auth/me
router.get('/me', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { specialist: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

export default router;
