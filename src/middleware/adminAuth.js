// src/middleware/adminAuth.js

module.exports = function adminAuth(req, res, next) {
  const secret = process.env.ADMIN_SECRET || 'admin123';

  // Verifica sessão via cookie simples
  const token = req.cookies?.admin_token;
  if (token === secret) return next();

  // Se for requisição de API, retorna 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  // Redireciona para login
  return res.redirect('/admin/login');
};
