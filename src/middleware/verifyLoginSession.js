async function verifyLoginSession(req, res, next) {
    const token = req.headers['authorization']?.split('')[1];
    if(!token) return res.status(401).json({message: 'Unauthorized'});

    const session = await prisma.loginSession.findUnique({
        where: {
            accessToken: token
        },
        include: {
            user: true
        }
    });

    if (!session) return res.status(401).json({ error: 'Invalid session'});
    if (new Date() > session.expiresAt) return res.status(401).json({ error: 'Session expired'});

    req.user = session.user;
    next();

}