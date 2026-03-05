class UserRepository(private val db: Database) {
    fun findById(id: String): User? {
        return db.query("SELECT * FROM users WHERE id = ?", id)
    }

    fun save(user: User): Boolean {
        return db.execute("INSERT INTO users VALUES (?)", user.id)
    }
}

fun greet(name: String): String = "Hello, $name"
